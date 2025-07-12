import express from 'express';
import dotenv from 'dotenv';
import mongoose, { ConnectOptions } from 'mongoose';
import path from 'path';
import { catchErrors } from './hooks/errors.ts';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

dotenv.config();

const app = express();
const port = 8001;

// Create HTTP server
const httpServer = createServer(app);

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '15gb' }));
app.use(express.urlencoded());
// Add headers
app.use(function (req, res, next) {
  // Origin to allow
  const allowedOrigins = [
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
  ];

  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  // Request methods
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  // Request headers
  res.setHeader('Access-Control-Expose-Headers', 'auth-token, x-forwarded-for');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With,content-type,auth-token,cancelToken,responsetype,x-forwarded-for,x-wallet-address,x-connect-token,content-length'
  );
  next();
});

app.disable('x-powered-by');
app.set('trust proxy', true);

// Serve static files from public directory
app.use('/api/screenshots', express.static(path.join(__dirname, 'public', 'screenshots')));
app.use('/api/recordings', express.static(path.join(__dirname, 'public', 'recordings')));

// api v1 endpoints
import { gymApi } from './api/gym.ts';
import { forgeApi } from './api/forge/index.ts';
import { walletApi } from './api/wallet.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { startRefreshInterval } from './services/forge/pools.ts';

app.use('/api/v1/gym', gymApi);
app.use('/api/v1/forge', forgeApi);
app.use('/api/v1/wallet', walletApi);

// error handling

app.use(errorHandler);

catchErrors();
async function connectToDatabase() {
  try {
    const dbURI = process.env.DB_URI;
    if (!dbURI) {
      throw new Error('DB_URI environment variable is not set.');
    }

    await mongoose.connect(dbURI);

    await mongoose.connection.db?.admin().command({ ping: 1 });
    console.log('Database connected!');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    // Set exit code to 1 for graceful shutdown in case of database connection error
    process.exitCode = 1;
    return;
  }
}

const host = '0.0.0.0';
if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(port, host, async () => {
    console.log(`Clones backend listening on port ${port}`);
    await connectToDatabase().catch(console.dir);
    // refresh pool status
    startRefreshInterval();
  });
}

export { app };
