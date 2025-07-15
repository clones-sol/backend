import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToDatabase } from './services/database.ts';
import { startRefreshInterval } from './services/forge/pools.ts';
import { gymApi } from './api/gym.ts';
import { forgeApi } from './api/forge/index.ts';
import { walletApi } from './api/wallet.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { initializeWebSocketServer } from './services/websockets/socketManager.ts';
import { catchErrors } from './hooks/errors.ts';
import { connectToRedis, disconnectFromRedis } from './services/redis.ts';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from '../swagger.ts';

const app = express();
const port = parseInt(process.env.PORT || '8001', 10);

// Create HTTP server
const httpServer = createServer(app);

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(express.json({ limit: '15gb' }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(cors({
  origin: [
    'tauri://localhost',
    'http://tauri.localhost',
    'http://localhost:1420',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8001',
    'http://18.157.122.205',
    'https://clones.sol',
    'https://clones-website-test.fly.dev',
    'https://clones-backend-test.fly.dev'
  ],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: [
    'X-Requested-With',
    'content-type',
    'auth-token',
    'cancelToken',
    'responsetype',
    'x-forwarded-for',
    'x-wallet-address',
    'x-connect-token',
    'content-length'
  ],
  exposedHeaders: ['auth-token', 'x-forwarded-for']
}));

app.disable('x-powered-by');
app.set('trust proxy', true);

// Serve static files from public directory
app.use('/api/screenshots', express.static(path.join(__dirname, 'public', 'screenshots')));
app.use('/api/recordings', express.static(path.join(__dirname, 'public', 'recordings')));

// API v1 endpoints
app.use('/api/v1/gym', gymApi);
app.use('/api/v1/forge', forgeApi);
app.use('/api/v1/wallet', walletApi);

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Not found handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

// Error handling
app.use(errorHandler);

catchErrors();

// Start server
if (process.env.NODE_ENV !== 'test') {
  const host = '0.0.0.0';
  httpServer.listen(port, host, async () => {
    console.log(`Clones backend listening on port ${port}`);
    await connectToDatabase().catch(console.dir);
    connectToRedis();

    // Initialize WebSocket server after Redis connection
    initializeWebSocketServer(httpServer);

    // Refreshing pools data
    await startRefreshInterval();
  });
}

// Graceful shutdown logic
const handleShutdown = () => {
  console.log(`\nReceived shutdown signal. Shutting down gracefully...`);
  httpServer.close(() => {
    console.log('HTTP server closed.');
    mongoose.disconnect().then(() => {
      console.log('MongoDB connection closed.');
      if (process.env.NODE_ENV !== 'test') {
        disconnectFromRedis();
        console.log('Redis connections closed.');
      }
      process.exit(0);
    });
  });
};

// Listen for termination signals
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

export { app, httpServer };
