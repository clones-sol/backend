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
- **Logging**: Pino with W3C Trace Context for distributed tracing

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
- **Clones Quality Agent (CQA) Configuration**:
  - `CQA_PATH`: Path to the Clones Quality Agent executable.
  - `CQA_MODEL` (optional): Model for CQA chunk evaluation (e.g., `gpt-4o-mini`).
  - `CQA_EVALUATION_MODEL` (optional): Model for CQA final evaluation for unbiased results (e.g., `gpt-4o-2024-08-06`). Defaults to `CQA_MODEL`.

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

## Logging & Observability

### Distributed Tracing System

The backend implements a comprehensive logging system with **W3C Trace Context** for distributed tracing and request correlation. Every log entry includes structured identifiers for full observability.

#### Log Identifiers

When you see logs like this:
```
correlationId: "af2222ae-51c9-46bc-872f-0738cf1fd313"
requestId: "579ebcef-1ad8-4cb2-823a-96f8100edb6a"  
traceId: "fd89d19b096f23e3d4055f93a8a699c1"
spanId: "4ba75139112690d5"
```

Here's what each identifier means:

**`correlationId`**
- **Purpose**: Unique identifier to track a request across all services
- **Use Case**: Groups all logs related to the same user request
- **Example**: If a user action triggers 5 different service calls, all will share the same `correlationId`

**`requestId`**
- **Purpose**: Unique identifier for this specific HTTP request
- **Use Case**: Differentiates each individual request at the Express server level
- **Example**: Each HTTP GET/POST call has its own `requestId`

**`traceId`**
- **Purpose**: Complete trace identifier following W3C Trace Context standard
- **Use Case**: Tracks a complete transaction across multiple systems/microservices
- **Format**: 32 hexadecimal characters (128 bits)

**`spanId`**
- **Purpose**: Identifier for a specific operation within the trace
- **Use Case**: Represents a unit of work (function call, database query, etc.)
- **Format**: 16 hexadecimal characters (64 bits)

#### Benefits

1. **Debugging**: Find all logs for a problematic request
2. **Performance**: Analyze the complete journey of a request
3. **Monitoring**: Track requests across microservices
4. **Observability**: Compatible with tools like Grafana, Jaeger, DataDog

With these identifiers, you can easily filter logs for a specific request and see its complete path through your system.

### Log Configuration

#### Development Mode
- **Format**: Pretty-printed with colors and timestamps
- **Level**: `debug` (shows all log levels)
- **Output**: Console with structured JSON fallback

#### Production Mode
- **Format**: Structured JSON for log aggregation
- **Level**: `info` (filters debug logs for performance)
- **Output**: JSON logs suitable for Grafana/Loki ingestion

#### Environment Variables
```bash
LOG_LEVEL=debug           # Minimum log level (debug, info, warn, error)
SERVICE_NAME=clones-backend  # Service identifier for logs
LOG_PRETTY=true           # Enable pretty printing in development
```

### Automatic Request Logging

Every HTTP request is automatically logged with:
- Request details (method, URL, headers, user agent)
- Response details (status code, content length)
- Performance metrics (duration, slow/very slow flags)
- User context (user ID, wallet address, session)
- Correlation and trace identifiers

### Code Quality Enforcement

The logging system enforces best practices:
- **Biome linting rules** ban `console.*` usage (CI will fail)
- **Structured logging** with proper log levels
- **Automatic context injection** via AsyncLocalStorage
- **Request correlation** across the entire request lifecycle

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

## Claim Rewards Security Flow

### Overview

The claim rewards system uses a **dual-layer security model** where **MongoDB acts as the authorization source** and **smart contracts enforce execution rules**. This architecture ensures that only legitimately earned rewards (evaluated and approved off-chain) can be claimed on-chain.

### Security Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ MongoDB: Authorization Source (Who Can Claim?)                      │
│ ✓ Only evaluated submissions with reward > 0                        │
│ ✓ submission.onChainReward.txHash tracks claim status              │
│ ✓ Controls which submissions are eligible for claiming             │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Smart Contract: Execution Rules (How to Claim?)                    │
│ ✓ Verifies publisher signature (authenticates platform)            │
│ ✓ Prevents replay attacks via cumulative pattern                   │
│ ✓ Enforces: cumulativeAmount > alreadyClaimed[account]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Two Signature Generations?

The system generates EIP-712 signatures in **two different places** for different purposes:

#### 1. In `processing.ts` (After Evaluation) - **INFORMATIVE**

**File**: `src/services/forge/processing.ts`

```typescript
// After CQA evaluation completes and reward is calculated
const claimAuthorization = await claimAuthService.generateClaimAuthorization(
  factory.poolAddress,
  submission.address,
  reward
)

// Stored in MongoDB: submission.claimAuthorization
```

**Purpose**: 
- Informational/preview signature
- Stored in MongoDB for reference
- **Can become obsolete** if user claims other submissions (changes `nonce` and `alreadyClaimed`)

**Why it exists**:
- Provides immediate feedback to user that claim is authorized
- Allows desktop app to show claim details without re-fetching
- Stores historical authorization data

#### 2. In `transaction.ts` (When User Claims) - **OPERATIONAL**

**File**: `src/api/transaction.ts`

```typescript
// SECURITY CHECK: Verify submission hasn't been claimed
const submission = await DemonstrationSubmission.findById(submissionId)

if (submission.onChainReward?.txHash) {
  throw ApiError.badRequest('This reward has already been claimed')
}

// Generate FRESH signature with CURRENT smart contract state
const claimAuthorization = await claimAuthService.generateClaimAuthorization(
  poolAddress,
  userAddress,
  amountNumber
)
```

**Purpose**:
- **Always fresh** with current smart contract state
- Includes current `nonce` from `RewardPoolImplementation.claimNonce(user)`
- Includes current `alreadyClaimed` for cumulative calculation

**Why it's regenerated**:
- **`nonce` changes** after each successful claim (replay protection)
- **`alreadyClaimed` changes** as user claims rewards
- Signature must reflect **real-time on-chain state**

### Complete Security Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Processing (After CQA Evaluation)                       │
│ File: src/services/forge/processing.ts                          │
├─────────────────────────────────────────────────────────────────┤
│ ✓ Demo scored by CQA (e.g., 80/100)                             │
│ ✓ Reward calculated: 8 tokens                                   │
│ ✓ Stored in MongoDB:                                            │
│   - submission.reward = 8                                       │
│   - submission.claimAuthorization = { ... } (informative)       │
│   - submission.onChainReward.txHash = null (not claimed yet)   │
│ ✓ Status: COMPLETED (eligible for claiming)                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: User Initiates Claim                                    │
│ Desktop App → Backend API                                       │
├─────────────────────────────────────────────────────────────────┤
│ ✓ User clicks "Claim Reward" in desktop                         │
│ ✓ Desktop sends: submissionId, poolAddress, amount             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Transaction Preparation                                 │
│ File: src/api/transaction.ts → prepare-tx endpoint             │
├─────────────────────────────────────────────────────────────────┤
│ SECURITY CHECKS (MongoDB):                                      │
│ ✓ Submission exists                                             │
│ ✓ Submission belongs to authenticated user                      │
│ ✓ submission.onChainReward.txHash === null (not claimed)       │
│                                                                  │
│ FETCH CURRENT STATE (Smart Contract):                           │
│ ✓ Read alreadyClaimed from RewardPoolImplementation            │
│ ✓ Read claimNonce from RewardPoolImplementation                │
│                                                                  │
│ GENERATE FRESH SIGNATURE:                                       │
│ ✓ newCumulativeAmount = alreadyClaimed + reward                │
│ ✓ Sign with publisher private key                              │
│ ✓ Include current nonce for replay protection                  │
│                                                                  │
│ RETURNS:                                                         │
│ {                                                                │
│   contractAddress: poolAddress,                                 │
│   functionName: 'payWithSig',                                   │
│   args: [account, cumulativeAmount, nonce, signature]          │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Smart Contract Execution                                │
│ Contract: RewardPoolImplementation.payWithSig()                 │
├─────────────────────────────────────────────────────────────────┤
│ SIGNATURE VERIFICATION:                                          │
│ ✓ Recover signer from EIP-712 signature                         │
│ ✓ Verify signer === publisher (from factory)                    │
│                                                                  │
│ REPLAY PROTECTION:                                               │
│ ✓ Verify: cumulativeAmount > alreadyClaimed[account]           │
│ ✓ Verify: nonce === claimNonce[account]                        │
│                                                                  │
│ EXECUTION:                                                       │
│ ✓ Calculate: gross = cumulativeAmount - alreadyClaimed         │
│ ✓ Calculate fee (10%)                                           │
│ ✓ Transfer net to user, fee to treasury                         │
│ ✓ Update: alreadyClaimed[account] = cumulativeAmount           │
│ ✓ Increment: claimNonce[account]++                             │
│                                                                  │
│ RESULT: Transaction hash                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Status Update                                           │
│ Backend updates MongoDB                                         │
├─────────────────────────────────────────────────────────────────┤
│ ✓ submission.onChainReward.txHash = "0x123..."                 │
│ ✓ Future claim attempts rejected (already claimed)             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Security Properties

1. **MongoDB Authorization**
   - **Source of Truth**: Only submissions evaluated by CQA can be claimed
   - **Double-Claim Prevention**: `onChainReward.txHash` check in `transaction.ts`
   - **User Ownership**: Submission must belong to authenticated user

2. **Smart Contract Enforcement**
   - **Publisher Authentication**: Only platform can authorize claims (via signature)
   - **Replay Protection**: Cumulative pattern + nonce prevents reusing signatures
   - **Atomic Execution**: Transfer to user and treasury in single transaction

3. **Why This Design?**
   - ✅ **Scalability**: Off-chain scoring, on-chain execution
   - ✅ **Security**: Multiple layers of validation
   - ✅ **Gas Efficiency**: Users pay only for final claim transaction
   - ✅ **Transparency**: All claims recorded on-chain with events

### Common Questions

**Q: Why not just use the signature from `processing.ts`?**

A: The signature in `processing.ts` becomes stale when:
- User claims other rewards (increments `nonce`)
- User's `alreadyClaimed` amount increases
- The signature must always reflect current smart contract state

**Q: Why does MongoDB store a signature if it's regenerated?**

A: The stored signature is for **informational purposes** only:
- Shows user their claim is authorized
- Provides preview of claim parameters
- Stores historical authorization data

**Q: What prevents someone from calling `transaction.ts` without a valid submission?**

A: Three layers of protection:
1. **MongoDB check**: Submission must exist with `reward > 0`
2. **Ownership check**: Submission must belong to authenticated user
3. **Claim status check**: `onChainReward.txHash` must be null

**Q: What prevents double-claiming the same submission?**

A: Two mechanisms:
1. **MongoDB**: `submission.onChainReward.txHash` check rejects if not null
2. **Smart Contract**: `alreadyClaimed` prevents claiming same cumulative amount twice

### Related Files

- **Signature Generation**: `src/services/blockchain/claimAuthService.ts`
- **Transaction Preparation**: `src/api/transaction.ts` (line 548-627)
- **Processing Flow**: `src/services/forge/processing.ts` (line 336-401)
- **Claim Validation API**: `src/api/claim.ts` (pre-validation endpoint)
- **Smart Contract ABI**: `src/contracts/abis/RewardPoolImplementation.json`

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