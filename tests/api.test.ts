import request from 'supertest';
import { app } from '../src/server';
import { supportedTokens } from '../src/services/blockchain/tokens';

// Mock the DB connection and other services if necessary
// For this example, we'll assume the server can run in a test environment

describe('Forge API', () => {
    let server: any;

    beforeAll((done) => {
        // Let's start the server on a random port
        server = app.listen(0, done);
    });

    afterAll((done) => {
        server.close(done);
    });

    describe('GET /api/v1/forge/pools/tokens', () => {
        it('should return a list of supported tokens', async () => {
            const response = await request(server).get('/api/v1/forge/pools/tokens');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toBeInstanceOf(Array);

            const expectedTokens = Object.entries(supportedTokens).map(([symbol, { name }]) => ({
                symbol,
                name
            }));

            expect(response.body.data).toEqual(expect.arrayContaining(expectedTokens));
        });
    });
}); 