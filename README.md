# Backend Server

This is the backend server for the Clones project. It manages the database, handles API requests, and powers real-time agent operations.

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

### Code Quality

The project uses [Biome](https://biomejs.dev/) for linting, formatting, and code quality enforcement.

#### Available Scripts

```bash
# Check code quality (lint + format)
npm run lint

# Auto-fix issues
npm run lint:fix

# Apply unsafe fixes (use with caution)
npm run lint:unsafe-fix

# Format code only
npm run format

# Check formatting without fixing
npm run format:check

# Run full quality check (typecheck + lint + tests)
npm run quality

# Auto-fix quality issues
npm run quality:fix
```

#### Pre-commit Hooks

Code quality checks run automatically on every commit via `lint-staged` and `husky`. This ensures consistent code quality across the project.

#### Configuration

Biome configuration is in `biome.json` with strict rules for:
- TypeScript type safety (no `any` allowed)
- Import organization
- Cognitive complexity limits
- Security best practices

## Quick Start

This guide covers the essential steps to get the backend running locally for development.

### Prerequisites

- [Docker](https://www.docker.com/get-started) installed on your system.
- [Node.js](https://nodejs.org/) for development (if running outside Docker)

### 1. Clone the Repository

```bash
git clone https://github.com/clones-ai/clones-backend.git
cd backend
```

### 2. Configure Environment

The backend is configured using an `.env` file. Copy the example file to get started:

```bash
cp .env.example .env
```

Next, open the `.env` file and provide the necessary values. Refer to the [Environment Setup section](https://docs.page/clones-ai/desktop/projects/backend#environment-setup) in the documentation for detailed instructions.

### 3. Run with Docker

The entire stack is managed with Docker Compose.

```bash
# Start all services in the background
docker compose up -d

# View backend logs
docker compose logs -f backend

# Execute a command inside the backend container (e.g., a script)
docker exec backend npm run <command>

# Stop and remove all containers, networks, and volumes
docker compose down
```

## Transaction API

### Supported Transaction Types

The backend supports the following blockchain transaction types:

- **`createFactory`** - Create a new reward pool factory (without funding)
- **`createAndFundFactory`** - Create and fund a reward pool atomically (optimal UX)
- **`fundPool`** - Fund an existing reward pool
- **`claimRewards`** - Claim rewards from pools

### Key Endpoints

#### POST `/api/v1/transaction/prepare-tx`
Prepares transaction data for client-side execution.

**Parameters:**
- `type` - Transaction type (`createFactory`, `createAndFundFactory`, `fundPool`, `claimRewards`)
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
- **createAndFundFactory**: ~280k gas (vs ~600k for separate transactions)
- **fundPool**: ~120k gas
- **claimRewards**: ~150k gas per claim