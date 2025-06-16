import express from 'express';
import dotenv from 'dotenv';
import mongoose, { ConnectOptions } from 'mongoose';
import { catchErrors } from './hooks/errors.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import fs from 'fs';

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
app.use(function(req, res, next) {
  // Origin to allow
  const allowedOrigins = [
    'tauri://localhost',
    'http://tauri.localhost',
    'http://localhost:1420',
    'http://localhost:3000',
    'http://localhost:8001',
    'http://18.157.122.205',
    'https://viralmind.ai'
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
  // Production configuration
  try {
    let clientOptions: ConnectOptions = {
      dbName: process.env.DB_NAME
    };
    if (process.env.NODE_ENV === 'production') {
      // Create a Mongoose client with a MongoClientOptions object to set the Stable API version
      const tlsCAFile = path.resolve('../aws/aws-global-bundle.pem');
      // Verify the certificate file exists
      if (!fs.existsSync(tlsCAFile)) {
        throw new Error(
          'TLS CA File not found. Please ensure aws-global-bundle.pem is present in the root directory'
        );
      }
      clientOptions = {
        tls: true,
        tlsAllowInvalidHostnames: false,
        readPreference: 'secondaryPreferred',
        retryWrites: false,
        replicaSet: 'rs0',
        tlsCAFile: tlsCAFile,
        ...clientOptions
      };
    }
    const dbURI = process.env.DB_URI;
    if (!dbURI) throw Error('No DB URI passed to connect.');
    await mongoose.connect(dbURI, clientOptions);
    await mongoose.connection.db?.admin().command({ ping: 1 });
    console.log('Database connected!');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  }
}

httpServer.listen(port, async () => {
  console.log(`Viralmind backend listening on port ${port}`);
  await connectToDatabase().catch(console.dir);
  // refresh pool status
  startRefreshInterval();
});
