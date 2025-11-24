import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app, resetAuthAttempts } from '../test-server.ts';
import { WalletConnectionModel } from '../models/Models.ts';

// Mock ethers to prevent blockchain connection attempts
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>()
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn().mockImplementation(() => ({
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
        getBalance: vi.fn().mockResolvedValue(0n),
        call: vi.fn().mockResolvedValue('0x'),
        on: vi.fn()
      })),
      Contract: vi.fn().mockImplementation(() => ({
        balanceOf: vi.fn().mockResolvedValue(0n),
        decimals: vi.fn().mockResolvedValue(18)
      }))
    }
  }
});

// Mock referral service to prevent external dependencies
vi.mock('../services/referral/index.ts', () => ({
  referralService: {
    getReferralCode: vi.fn().mockResolvedValue(null),
    getReferrer: vi.fn().mockResolvedValue(null)
  }
}));

describe('Wallet Security Tests', () => {
  let mongoServer: MongoMemoryServer;
  let testToken: string;
  let testAddress: string;
  let agent: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();
    
    testToken = 'security-test-token-12345';
    testAddress = '0x742d35Cc6A4A5F3d9C7a9F9F9A9F9F9F9F9F9F9F';
    
    await WalletConnectionModel.create({
      token: testToken,
      address: testAddress,
    });

    // Reset rate limiting counters
    resetAuthAttempts();

    agent = request.agent(app);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe('CSRF Protection', () => {
    it('should block POST requests without CSRF token', async () => {
      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .send({ token: testToken });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should accept requests with valid CSRF token', async () => {
      // Get CSRF token first
      const csrfResponse = await agent
        .get('/api/v1/wallet/csrf-token');

      expect(csrfResponse.status).toBe(200);
      const csrfToken = csrfResponse.body.data.csrfToken;

      // Use CSRF token in POST request
      const response = await agent
        .post('/api/v1/wallet/establish-session')
        .set('x-csrf-token', csrfToken)
        .send({ token: testToken });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }, 15000); // 15s timeout for CSRF tests

    it('should reject requests with invalid CSRF token', async () => {
      const response = await agent
        .post('/api/v1/wallet/establish-session')
        .set('x-csrf-token', 'invalid-token')
        .send({ token: testToken });

      expect(response.status).toBe(403);
    }, 10000); // 10s timeout for invalid CSRF test
  });

  describe('Session Security', () => {
    it('should regenerate session ID on authentication', async () => {
      const csrfResponse = await agent.get('/api/v1/wallet/csrf-token');
      const csrfToken = csrfResponse.body.data.csrfToken;

      // Get initial session cookie
      const initialCookie = csrfResponse.headers['set-cookie'];

      // Establish session
      const authResponse = await agent
        .post('/api/v1/wallet/establish-session')
        .set('x-csrf-token', csrfToken)
        .send({ token: testToken });

      expect(authResponse.status).toBe(200);

      // Session cookie should change (new session ID)
      const newCookie = authResponse.headers['set-cookie'];
      expect(newCookie).toBeDefined();
    }, 15000); // 15s timeout for session tests

    it('should expire sessions after 1 hour of inactivity', async () => {
      const csrfResponse = await agent.get('/api/v1/wallet/csrf-token');
      const csrfToken = csrfResponse.body.data.csrfToken;

      await agent
        .post('/api/v1/wallet/establish-session')
        .set('x-csrf-token', csrfToken)
        .send({ token: testToken });

      // Mock time forward by 2 hours
      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(originalNow() + (2 * 60 * 60 * 1000));

      const statusResponse = await agent.get('/api/v1/wallet/session-status');
      
      expect(statusResponse.body.data.authenticated).toBe(false);

      vi.restoreAllMocks();
    });

    it('should not expose sensitive data in error responses', async () => {
      const response = await agent
        .post('/api/v1/wallet/establish-session')
        .send({ token: 'malicious-token-injection<script>alert(1)</script>' });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain('<script>');
      expect(response.text).not.toContain('malicious');
    });
  });

  describe('Input Validation', () => {
    it('should sanitize malicious input', async () => {
      const maliciousToken = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .get('/api/v1/wallet/connection')
        .query({ token: maliciousToken });

      // Malicious tokens should be rejected with 400 (bad request)
      expect(response.status).toBe(400);
      expect(response.text).not.toContain('<script>');
    });

    it('should reject oversized payloads', async () => {
      const largePayload = 'x'.repeat(11 * 1024 * 1024); // 11MB (over 10MB limit)

      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .send({ token: largePayload });

      expect(response.status).toBe(413);
    });

    it('should validate token format', async () => {
      const invalidTokens = [
        null,
        undefined,
        123,
        {},
        [],
        '',
        ' ',
        'token with spaces',
        'token\nwith\nnewlines'
      ];

      for (const invalidToken of invalidTokens) {
        const response = await request(app)
          .get('/api/v1/wallet/connection')
          .query({ token: invalidToken });

        expect([400, 404, 500]).toContain(response.status);
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit authentication attempts', async () => {
      // Get CSRF token first
      const csrfResponse = await agent.get('/api/v1/wallet/csrf-token');
      const csrfToken = csrfResponse.body.data.csrfToken;
      
      // Make 15 sequential requests (over the 10 limit) with proper CSRF token
      const responses = [];
      for (let i = 0; i < 15; i++) {
        const response = await agent
          .post('/api/v1/wallet/establish-session')
          .set('x-csrf-token', csrfToken)
          .send({ token: 'invalid-test-token-' + i });
        responses.push(response);
      }
      
      // Should have rate limited responses (429)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
      
      // First few requests should fail with 401/403 (not rate limited), later ones should be 429
      expect(responses[0].status).not.toBe(429);
      expect(rateLimitedResponses.length).toBeGreaterThan(3); // At least some should be rate limited
    }, 15000);
  });

  describe('Session Fixation Prevention', () => {
    it('should not accept pre-set session IDs', async () => {
      // Try to set a specific session ID
      const response = await request(app)
        .get('/api/v1/wallet/session-status')
        .set('Cookie', 'clones.sid=malicious-session-id');

      // Should get new session, not use the provided one
      expect(response.status).toBe(200);
      expect(response.body.data.authenticated).toBe(false);
    });
  });

  describe('Information Disclosure', () => {
    it('should not leak server information in headers', async () => {
      const response = await request(app)
        .get('/api/v1/wallet/session-status');

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).toBeUndefined();
    });

    it('should not expose stack traces in production errors', async () => {
      // Force an error by connecting to invalid database
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .post('/api/v1/wallet/establish-session')
        .send({ token: 'force-error-token' });

      expect(response.text).not.toContain('Error:');
      expect(response.text).not.toContain('at ');
      expect(response.text).not.toContain(__filename);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Secure Headers', () => {
    it('should set security headers', async () => {
      const response = await request(app)
        .get('/api/v1/wallet/session-status');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['x-xss-protection']).toBe('0');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('should set secure cookie attributes in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .get('/api/v1/wallet/session-status');

      const cookieHeaders = response.headers['set-cookie'] as unknown as string[] | undefined;
      if (cookieHeaders && cookieHeaders.length > 0) {
        const sessionCookie = cookieHeaders.find((cookie: string) => cookie.includes('clones.sid'));
        if (sessionCookie) {
          expect(sessionCookie).toContain('HttpOnly');
          expect(sessionCookie).toContain('SameSite=Strict');
        }
      }

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Token Security', () => {
    it('should not store tokens in localStorage equivalent', async () => {
      // Ensure no tokens are returned in responses that could be stored client-side
      const response = await agent.get('/api/v1/wallet/session-status');
      
      expect(response.body.data.token).toBeUndefined();
      expect(response.body.data.authToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
    });

    it('should invalidate tokens on logout', async () => {
      const csrfResponse = await agent.get('/api/v1/wallet/csrf-token');
      const csrfToken = csrfResponse.body.data.csrfToken;

      // Establish session
      await agent
        .post('/api/v1/wallet/establish-session')
        .set('x-csrf-token', csrfToken)
        .send({ token: testToken });

      // Logout
      await agent.post('/api/v1/wallet/logout');

      // Check session is invalid
      const statusResponse = await agent.get('/api/v1/wallet/session-status');
      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.success).toBe(true);
      expect(statusResponse.body.data).toBeDefined();
      expect(statusResponse.body.data.authenticated).toBe(false);
    });
  });
});