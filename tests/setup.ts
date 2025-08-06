// This file is run by Vitest before any tests are executed.
import { randomBytes } from 'crypto';

// Set environment variables for the test suite
process.env.DEPOSIT_KEY_ENCRYPTION_SECRET = randomBytes(32).toString('hex');
process.env.DEPOSIT_KEY_ENCRYPTION_SALT = randomBytes(16).toString('hex');

process.env.DB_URI = 'mongodb://admin:admin@mongodb:27017/dev?authSource=admin';
process.env.RPC_URL = 'http://mock-rpc-url-for-tests.com';
process.env.OPENAI_API_KEY = 'mock-openai-api-key';
process.env.FORGE_WEBHOOK = 'mock-forge-webhook';
process.env.GYM_FORGE_WEBHOOK = 'mock-gym-forge-webhook';
process.env.IPC_SECRET = 'mock-ipc-secret';
process.env.GYM_SECRET = 'mock-gym-secret';
process.env.AX_PARSER_SECRET = 'mock-ax-parser-secret';
process.env.FEEDBACK_WEBHOOK = 'mock-feedback-webhook';
process.env.GYM_TREASURY_WEBHOOK = 'mock-gym-treasury-webhook';
process.env.STORAGE_ACCESS_KEY = 'mock-storage-access-key';
process.env.STORAGE_SECRET_KEY = 'mock-storage-secret-key';
process.env.STORAGE_ENDPOINT = 'http://localstack:4566';
process.env.STORAGE_REGION = 'us-east-1';
process.env.STORAGE_BUCKET = 'training-gym';
process.env.PIPELINE_PATH = '/app/pipeline';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-api-key';

// Referral system environment variables
process.env.REFERRAL_PROGRAM_ID = '11111111111111111111111111111111';
process.env.FRONTEND_URL = 'https://clones-ai.com';
process.env.ADMIN_TOKEN = 'mock-admin-token-for-tests';

// Reward Pool system environment variables
process.env.REWARD_POOL_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
process.env.PLATFORM_TREASURY_ADDRESS = 'TreasuryAddress123456789';
process.env.REWARD_POOL_RPC_URL = 'https://api.devnet.solana.com';