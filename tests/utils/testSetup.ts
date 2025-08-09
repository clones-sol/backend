import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase } from '../../src/services/database';

export interface TestSetupResult {
  mongoServer: MongoMemoryServer;
  mongoUri: string;
}

/**
 * Shared utility for setting up MongoDB memory server for tests
 * Reduces code duplication across test files
 */
export async function setupTestMongoDB(): Promise<TestSetupResult> {
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  process.env.DB_URI = mongoUri;
  await connectToDatabase();
  
  return { mongoServer, mongoUri };
}

/**
 * Clean up MongoDB memory server after tests
 */
export async function teardownTestMongoDB(mongoServer: MongoMemoryServer): Promise<void> {
  if (mongoServer) {
    await mongoServer.stop();
  }
  await mongoose.disconnect();
}
