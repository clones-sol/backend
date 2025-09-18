# Clones Backend Server

Node.js/Express backend server for the Clones AI platform that handles demo environments, forge operations, blockchain interactions, and real-time agent communications.

## Security Architecture

This backend follows a **transaction preparation security model**:
- **No private keys stored server-side**: All transactions are signed client-side via MetaMask
- **Transaction preparation APIs**: Server prepares contract interaction data for frontend execution
- **Session-based validation**: Secure transaction parameter validation
- **EIP-712 compliance**: Structured data preparation for wallet signatures
- **Atomic operations**: Single-transaction create+fund for optimal UX and gas efficiency

## Documentation

For complete setup instructions, architectural deep-dives, and contribution guidelines, please refer to the **[Clones Developer Guide](https://docs.page/clones-ai/desktop)**.

Backend-specific details are available in the **[Backend Setup Guide](https://docs.page/clones-ai/desktop/projects/backend)**.

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start development server with nodemon
npm run build           # Build with esbuild
npm start              # Start production server

# Type Checking
npm run tsc            # TypeScript compilation
npm run typecheck      # Type checking without emit
npm run typecov        # Type coverage analysis

# Testing
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run test:ui        # UI interface
npm run test:json      # JSON reporter

# Code Quality
npm run lint           # Check with Biome
npm run lint:fix       # Auto-fix issues
npm run lint:unsafe-fix # Apply unsafe fixes
npm run format         # Format code
npm run format:check   # Check formatting
npm run quality        # Full check (typecheck + lint + tests)
npm run quality:fix    # Auto-fix quality issues
```

### Code Quality & Testing

- **Linter/Formatter**: [Biome](https://biomejs.dev/) with strict TypeScript rules
- **Testing**: Vitest with MongoDB Memory Server and ioredis-mock
- **Pre-commit**: Husky + lint-staged for automated quality checks
- **Type Safety**: Strict TypeScript with type coverage reporting

## Architecture Overview

### Core Stack
- **Runtime**: Node.js 20.17.0 (Alpine) with ES modules
- **Framework**: Express 5.x with TypeScript
- **Database**: MongoDB 8.0.4 with Mongoose ODM
- **Cache/Sessions**: Redis 7 with ioredis client
- **Build**: esbuild for fast bundling
- **Real-time**: WebSocket server for agent operations
- **Security**: Helmet, CSRF protection, secure sessions

### Key Dependencies
- **AI/LLM**: Anthropic SDK, OpenAI SDK
- **Blockchain**: ethers.js v6, OpenZeppelin contracts
- **Storage**: AWS SDK S3 (LocalStack/Tigris)
- **Validation**: Zod schemas, express-validator
- **WebSocket**: ws library for real-time communication

### Deployment Environments

#### 🏠 Local Development
- **Infrastructure**: Docker Compose stack
- **Services**: MongoDB 8.0.4, Redis 7, LocalStack S3, Backend dev server
- **Storage**: LocalStack S3 simulation (`training-gym` bucket)
- **Configuration**: `.env` file with local defaults
- **Command**: `docker compose up -d`

#### 🧪 Test Environment  
- **Backend**: Fly.io app (`clones-backend-test`) - 1GB RAM, shared CPU
- **Database**: Fly.io MongoDB (`clones-mongodb-test`) - 512MB RAM
- **Storage**: Tigris (`clones-backend-test` bucket)
- **Configuration**: Fly.io secrets
- **Commands**: 
  ```bash
  fly deploy --config fly.test.toml
  fly deploy --config fly.mongodb.test.toml
  ```

#### 🚀 Production Environment
- **Backend**: Fly.io app (`clones-backend-prod`) - 1GB RAM, shared CPU
- **Database**: Fly.io MongoDB (`clones-mongodb-prod`) - 1GB RAM
- **Storage**: Tigris (`clones-backend-prod` bucket)  
- **Configuration**: Fly.io secrets
- **Commands**:
  ```bash
  fly deploy --config fly.prod.toml
  fly deploy --config fly.mongodb.prod.toml
  ```

## Quick Start (Local Development)

### Prerequisites

- [Docker](https://www.docker.com/get-started) and Docker Compose
- [Node.js 20+](https://nodejs.org/) for local development
- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) for deployments

### 1. Clone the Repository

```bash
git clone https://github.com/clones-ai/clones-backend.git
cd clones-backend
```

### 2. Configure Environment

The backend is configured using an `.env` file. Copy the example file to get started:

```bash
cp .env.example .env
```

Next, open the `.env` file and provide the necessary values. Key variables include:

- `SESSION_SECRET`: A secure random string (minimum 32 characters) used for session encryption. In production, this should be stored as a secure secret (e.g., Fly.io secrets).
- **Storage Configuration**: Object storage credentials for file uploads and training data (see Object Storage section below).

Refer to the [Environment Setup section](https://docs.page/clones-ai/desktop/projects/backend#environment-setup) in the documentation for detailed instructions on all environment variables.

### 3. Start Development Stack

The entire development environment runs in Docker:

```bash
# Create the docker network first (if it doesn't exist)
docker network create clones-network 2>/dev/null || true

# Start all services (MongoDB, Redis, LocalStack S3, Backend)
docker compose up -d

# View backend logs
docker compose logs -f backend-dev

# Run commands inside backend container
docker exec backend npm test
docker exec backend npm run typecheck

# Stop all services
docker compose down
```

### 4. Verify Setup

Once running, verify the setup:
- **Backend API**: http://localhost:8001/api/v1/forge/metadata/health
- **MongoDB**: localhost:27017 (admin/admin)
- **Redis**: localhost:6379
- **LocalStack S3**: localhost:4566

## Production Deployment

### Test Environment
```bash
# Deploy backend and database
fly deploy --config fly.test.toml
fly deploy --config fly.mongodb.test.toml

# Set secrets (first time setup)
fly secrets set SESSION_SECRET=xxx STORAGE_ACCESS_KEY=xxx -a clones-backend-test
fly secrets set MONGO_INITDB_ROOT_PASSWORD=xxx -a clones-mongodb-test

# Monitor deployment
fly logs -a clones-backend-test
```

### Production Environment  
```bash
# Deploy backend and database
fly deploy --config fly.prod.toml
fly deploy --config fly.mongodb.prod.toml

# Set production secrets
fly secrets set SESSION_SECRET=xxx STORAGE_ACCESS_KEY=xxx -a clones-backend-prod
fly secrets set MONGO_INITDB_ROOT_PASSWORD=xxx -a clones-mongodb-prod

# Monitor production
fly logs -a clones-backend-prod
```

## Transaction API

### Supported Transaction Types

The backend supports the following blockchain transaction types:

- **`createFactory`** - Create a new reward pool factory (without funding)
- **`createAndFundPool`** - Create and fund a reward pool atomically (optimal UX)
- **`fundPool`** - Fund an existing reward pool
- **`claimRewards`** - Claim rewards from pools

### Key Endpoints

#### POST `/api/v1/transaction/prepare-tx`
Prepares transaction data for client-side execution.

**Parameters:**
- `type` - Transaction type (`createFactory`, `createAndFundPool`, `fundPool`, `claimRewards`)
- `sessionToken` - Authenticated session token
- `creator` - Creator wallet address (for create operations)
- `token` - Token symbol (e.g., "USDC")
- `amount` - Amount to fund (for funding operations)
- `poolAddress` - Pool address (for fund/claim operations)

**Returns:** Contract call data for MetaMask execution

#### POST `/api/v1/transaction/estimate-gas`
Estimates gas costs for transactions.

#### POST `/api/v1/transaction/validate-tx`
Validates transaction parameters before execution.

### Gas Optimization

- **createFactory**: ~200k gas
- **createAndFundPool**: ~280k gas (vs ~600k for separate transactions)
- **fundPool**: ~120k gas
- **claimRewards**: ~150k gas per claim

## Object Storage

The backend supports both local development (LocalStack) and production (Tigris) object storage for file uploads and training data.

### Storage Configuration

#### Local Development (LocalStack S3)
The Docker Compose stack includes LocalStack for S3-compatible storage:

```env
STORAGE_ACCESS_KEY=test
STORAGE_SECRET_KEY=test
STORAGE_ENDPOINT=http://localstack:4566
STORAGE_REGION=us-east-1
STORAGE_BUCKET=training-gym
```

#### Production (Tigris via Fly.io)
Test and production use Tigris object storage:

```env
STORAGE_ACCESS_KEY=your_tigris_access_key
STORAGE_SECRET_KEY=your_tigris_secret_key
STORAGE_ENDPOINT=https://fly.storage.dev
STORAGE_REGION=auto
STORAGE_BUCKET=clones-backend-test  # or clones-backend-prod
```

#### Setup Instructions

1. **Create Tigris Buckets**: `clones-backend-test`, `clones-backend-prod`
2. **Generate Access Keys**: Environment-specific with bucket permissions
3. **Configure Fly Secrets**:
   ```bash
   fly secrets set STORAGE_ACCESS_KEY=xxx STORAGE_SECRET_KEY=xxx -a clones-backend-test
   ```

#### Technical Details

- **Path Style**: Auto-configured (LocalStack: true, Tigris: false)
- **File Organization**: Feature-based paths (`training-data/`, `uploads/`, `forge/`, `gym/`)
- **Security**: Private buckets with IAM-controlled access
- **Integration**: AWS SDK S3 client with environment-specific endpoints