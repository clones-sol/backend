import session from 'express-session';
import MongoStore from 'connect-mongo';
import { doubleCsrf } from 'csrf-csrf';
import { Application } from 'express';

// Global CSRF configuration - single source of truth
let csrfConfig: ReturnType<typeof doubleCsrf>;

/**
 * Get the global CSRF config - for use in other modules
 */
export function getCSRFConfig() {
  return csrfConfig;
}

/**
 * Secure session configuration with MongoDB store
 * Integrates with existing WalletConnection mechanism
 */
export function configureSecureSession(app: Application): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUrl = process.env.DB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/clones';
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }

  // Configure express-session with MongoDB store
  app.use(session({
    name: 'clones.sid', // Custom session name
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiry on activity
    cookie: {
      secure: process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true', // HTTPS when in production or forced
      httpOnly: true, // Prevent XSS access
      maxAge: 60 * 60 * 1000, // 1 hour
      sameSite: 'strict', // Always strict for CSRF protection
      domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
      path: '/'
    },
    store: MongoStore.create({
      mongoUrl,
      collectionName: 'http_sessions',
      touchAfter: 24 * 3600, // Lazy session update
      ttl: 60 * 60, // 1 hour TTL
      crypto: {
        secret: sessionSecret
      }
    })
  }));

  // Initialize global CSRF configuration (single source of truth)
  try {
    csrfConfig = doubleCsrf({
      getSecret: () => sessionSecret, // Same secret as session
      cookieName: isProduction ? '__Host-psifi.x-csrf-token' : 'psifi.x-csrf-token', // Security prefix only in production
      cookieOptions: {
        httpOnly: true,
        secure: isProduction || process.env.FORCE_HTTPS === 'true',
        sameSite: 'strict', // Always strict for maximum security
        path: '/',
        domain: isProduction ? process.env.COOKIE_DOMAIN : undefined
      },
      size: 64, // Token size
      ignoredMethods: ['GET', 'HEAD', 'OPTIONS'], // Methods to ignore
      getTokenFromRequest: (req) => {
        // Check multiple sources for token
        return req.headers['x-csrf-token'] ||
          req.body._csrf ||
          req.query._csrf;
      }
    });
    console.log('CSRF configuration initialized successfully');
  } catch (error) {
    console.error('CSRF configuration initialization failed');
    throw new Error('Failed to initialize CSRF protection');
  }

  // Bootstrap endpoints that should NOT require CSRF protection
  const csrfExceptions = [
    // BOOTSTRAP AUTHENTICATION (no CSRF needed)
    '/api/v1/wallet/connect',        // Initial wallet connection
    '/api/v1/wallet/session-status', // Session status check
    '/api/v1/wallet/csrf-token',     // CSRF token retrieval
    '/api/v1/wallet/establish-session', // Session from transaction token
    '/api/v1/wallet/establish-session-from-transaction', // Session from transaction sessionId

    // DESKTOP READ-ONLY QUERIES (no CSRF needed)
    '/api/v1/wallet/balance',        // Balance queries (GET)
    '/api/v1/wallet/connection',     // Connection status (GET)
    '/api/v1/forge/factories', // Factory list (GET/PUT)
    '/api/v1/forge/factories/search', // Factory search (POST but read-only)
    '/api/v1/forge/factories/apps',  // Factory apps list (POST but read-only)
    '/api/v1/forge/factories/supported-tokens', // Supported tokens list (GET)
    '/api/v1/forge/pools/predict-address', // Address prediction (POST but read-only)
    '/api/v1/forge/chat',            // AI chat interactions from desktop (POST)
    '/api/v1/transaction/session',   // Transaction session info (GET)
    '/api/v1/transaction/status',    // Transaction status (GET)
    '/api/v1/transaction/complete',    // Transaction complete (POST)
    '/api/v1/transaction/estimate-gas', // Gas estimation (POST but read-only)
    '/api/v1/transaction/prepare-tx', // Transaction preparation (POST but read-only)
    '/api/v1/transaction/finalize-factory', // Factory finalization from desktop (POST)
    '/api/v1/forge/upload/init', // Upload init (POST)
    '/api/v1/forge/upload/chunk', // Upload chunk (POST)
    '/api/v1/forge/upload/complete', // Upload complete (POST)
    '/api/v1/forge/upload/cancel', // Upload cancel (POST)
    '/api/v1/forge/upload/status', // Upload status (GET)
    '/api/v1/referral/generate-code', // Generate referral code (POST)
    '/api/v1/referral/code', // Get referral code (GET)
    'api/v1/referral/apply-referrer-code', // Apply referrer code (POST)
    '/api/v1/referral/stats', // Get referral stats (GET)
    '/api/v1/referral/referred', // Get referred status (GET)
    '/api/v1/referral/cleanup/stats', // Get cleanup stats (GET)
    '/api/v1/referral/referrer', // Get referrer (GET)
    '/api/v1/referral/cleanup/expired-codes', // Clean up expired codes (POST)
    '/api/v1/referral/cleanup/stats', // Extend expiration (POST)
    '/api/v1/referral/cleanup/extend-expiration', // Extend expiration (POST)
    '/api/v1/referral/cleanup/regenerate-code', // Regenerate code (POST)
  ];

  // Apply CSRF protection to all routes except bootstrap endpoints
  app.use((req, res, next) => {
    // Add debugging for CSRF issues
    if (process.env.NODE_ENV !== 'production') {
      // Only log sensitive info if CSRF_DEBUG is explicitly enabled
      const debugInfo: any = {
        method: req.method,
        url: req.url,
        isExempt: csrfExceptions.includes(req.path)
      };
      if (process.env.CSRF_DEBUG === 'true') {
        debugInfo.cookies = req.cookies;
        debugInfo.session = req.session ? {
          authenticated: req.session.authenticated,
          walletAddress: req.session.walletAddress
        } : null;
        debugInfo.headers = {
          'x-csrf-token': req.headers['x-csrf-token'],
          'cookie': req.headers.cookie,
          'user-agent': req.headers['user-agent'],
          'referer': req.headers['referer']
        };
      }
      // console.log('CSRF Debug:', debugInfo);
    }

    // Check if this endpoint should skip CSRF protection
    const shouldSkipCSRF = csrfExceptions.some(exception =>
      req.path === exception || req.path.startsWith(exception + '/')) ||
      // Special patterns for dynamic paths
      req.path.match(/^\/api\/v1\/forge\/factories\/pools\/0x[a-fA-F0-9]{40}\/balance$/) || // Pool balance queries
      req.path.match(/^\/api\/v1\/wallet\/balance\/0x[a-fA-F0-9]{40}/);

    if (shouldSkipCSRF) {
      if (process.env.CSRF_DEBUG === 'true') {
        console.log(`CSRF exemption applied for bootstrap endpoint: ${req.path}`);
      }
      return next(); // Skip CSRF protection for bootstrap endpoints
    }

    // Handle CSRF protection with proper error handling
    const originalNext = next;
    const csrfNext = (error?: any) => {
      if (error) {
        // If CSRF validation fails, pass the error to Express error handler
        originalNext(error);
      } else {
        // Continue normally
        originalNext();
      }
    };

    try {
      csrfConfig.doubleCsrfProtection(req, res, csrfNext);
    } catch (error) {
      // Synchronous errors are passed to Express error handler
      originalNext(error);
    }
  });
}

// Extend Express Session interface
declare module 'express-session' {
  interface SessionData {
    walletAddress?: string;
    authToken?: string;
    authenticated?: boolean;
    lastActivity?: number;
  }
}

/**
 * Verify that a token belongs to a specific wallet address
 */
async function verifyWalletTokenOwnership(token: string, expectedAddress?: string): Promise<boolean> {
  try {
    const { WalletConnectionModel } = await import('../models/Models.ts');
    const connection = await WalletConnectionModel.findOne({ token });

    if (!connection?.address) {
      return false;
    }

    // If expectedAddress is provided, verify it matches
    if (expectedAddress) {
      return connection.address.toLowerCase() === expectedAddress.toLowerCase();
    }

    return true;
  } catch (error) {
    console.error('Token ownership verification failed:', error);
    return false;
  }
}

/**
 * Middleware to create secure session from wallet token
 */
export function createSessionFromToken() {
  return async (req: any, res: any, next: any) => {
    const { token, address } = req.body;

    if (!token) {
      return next();
    }

    try {
      // Verify token ownership
      const isValidToken = await verifyWalletTokenOwnership(token, address);
      if (!isValidToken) {
        console.warn('Invalid token or address mismatch for session creation');
        res.status(401).json({
          success: false,
          error: 'Invalid authentication token'
        });
        return; // Stop middleware execution
      }

      // Check if wallet connection exists
      const { WalletConnectionModel } = await import('../models/Models.ts');
      const connection = await WalletConnectionModel.findOne({ token });

      if (connection?.address) {
        // In test environment, skip session regeneration to avoid blocking
        if (process.env.NODE_ENV === 'test') {
          // Just set the session data directly in tests
          req.session.walletAddress = connection.address;
          req.session.authToken = token;
          req.session.authenticated = true;
          req.session.lastActivity = Date.now();
        } else {
          // Production: Regenerate session to prevent session fixation attacks
          await new Promise<void>((resolve, reject) => {
            req.session.regenerate((err: any) => {
              if (err) {
                console.error('Session regeneration failed:', err);
                reject(err);
              } else {
                resolve();
              }
            });
          });

          // Create secure session with new session ID
          req.session.walletAddress = connection.address;
          req.session.authToken = token;
          req.session.authenticated = true;
          req.session.lastActivity = Date.now();

          await new Promise((resolve, reject) => {
            req.session.save((err: any) => {
              if (err) {
                console.error('Session save failed:', err);
                reject(err);
              } else {
                resolve(undefined);
              }
            });
          });
        }
      }
    } catch (error) {
      console.error('Session creation failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Session creation failed'
      });
    }

    next();
  };
}

/**
 * Middleware to validate secure session
 */
export function requireSecureSession() {
  return (req: any, res: any, next: any) => {
    if (!req.session?.authenticated || !req.session?.walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check session freshness (max 1 hour inactive)
    const lastActivity = req.session.lastActivity || 0;
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    if (lastActivity < oneHourAgo) {
      req.session.destroy(() => { });
      return res.status(401).json({
        success: false,
        error: 'Session expired'
      });
    }

    // Update last activity
    req.session.lastActivity = Date.now();

    // Attach wallet address to request for compatibility
    req.walletAddress = req.session.walletAddress;

    next();
  };
}

/**
 * Get CSRF token endpoint (Modern 2025 version)
 */
export function getCsrfToken() {
  return (req: any, res: any) => {
    if (!csrfConfig) {
      return res.status(500).json({
        success: false,
        error: 'CSRF configuration not initialized'
      });
    }

    try {
      const token = csrfConfig.generateToken(req, res);

      res.json({
        success: true,
        data: {
          csrfToken: token
        }
      });
    } catch (error) {
      console.error('CSRF token generation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate CSRF token'
      });
    }
  };
}