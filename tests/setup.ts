// This file is run by Vitest before any tests are executed.

process.env.DB_URI = 'mongodb://admin:admin@mongodb:27017/dev?authSource=admin';
process.env.RPC_URL = 'http://localhost:8545'; // Use localhost to avoid external API rate limits
process.env.OPENAI_API_KEY = 'mock-openai-api-key';
process.env.REWARD_POOL_FACTORY_ADDRESS = '0xMockFactoryAddress';
process.env.CLAIM_ROUTER_ADDRESS = '0xMockClaimRouter';
process.env.PUBLISHER_ADDRESS = '0xMockPublisher';
process.env.STORAGE_ACCESS_KEY = 'mock-storage-access-key';
process.env.STORAGE_SECRET_KEY = 'mock-storage-secret-key';
process.env.STORAGE_ENDPOINT = 'http://localstack:4566';
process.env.STORAGE_REGION = 'us-east-1';
process.env.STORAGE_BUCKET = 'training-gym';
process.env.CQA_PATH = '/app/clones-quality-agent';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-api-key';

// Referral system environment variables
process.env.FRONTEND_URL = 'https://clones-ai.com';
process.env.ADMIN_TOKEN = 'mock-admin-token-for-tests';