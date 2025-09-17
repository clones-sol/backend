# Backend Architecture

## Overview

The Clones backend implements a **transaction preparation architecture** where the server prepares blockchain transaction data for client-side execution, ensuring maximum security by never storing private keys.

## Core Components

### API Layer (`src/api/`)
- **Factory APIs** (`/api/v1/forge/factory/`): Pool creation, funding, and claim management
- **Transaction APIs** (`/api/transaction/`): Session validation, gas estimation, transaction preparation
- **Authentication**: Wallet signature-based authentication with session tokens

### Services Layer (`src/services/`)

#### Blockchain Services
- **FactoryService**: Prepares transaction data for reward pool operations
- **BlockchainService**: Core blockchain interactions and utilities
- **GasEstimationService**: Gas cost estimation with expense warnings

#### Core Services
- **LLM Providers**: OpenAI/Anthropic integration for AI operations
- **Storage Services**: File management and metadata storage
- **WebSocket**: Real-time communication for agent operations

### Database Layer (`src/models/`)
- **MongoDB**: Primary data persistence with Mongoose ODM
- **Redis**: Session management and caching

## Transaction Flow

### 1. Session Creation
```
Desktop App → Backend API → Session Token → Wallet Connection Storage
```

### 2. Transaction Preparation
```
Frontend Request → Parameter Validation → Contract Data Preparation → Response with Transaction Data
```

### 3. Client Execution
```
Transaction Data → MetaMask/Wallet → Blockchain → Transaction Receipt
```

### 4. Status Tracking
```
Transaction Hash → Backend Callback → Status Update → UI Notification
```

## Security Model

### No Private Keys
- Server never stores or accesses private keys
- All transaction signing handled client-side
- Only public addresses and contract addresses in environment

### Session Security
- Token-based authentication with expiration
- Session validation for all transaction operations
- Wallet address verification

### Transaction Validation
- Parameter validation before preparation
- Allowance checking for token operations
- Contract state validation (pool existence, token allowlist)

## Smart Contracts Integration

### Factory Pattern (EIP-1167)
- Deterministic pool addresses via CREATE2
- Minimal proxy pattern for gas efficiency
- Publisher-controlled reward parameters

### Supported Operations
- **Pool Creation**: Factory-based deployment with token allowlist
- **Pool Funding**: ERC20 token deposits with allowance validation
- **Reward Claims**: EIP-712 signed claims with batch processing
- **Gas Estimation**: Accurate cost prediction with expense warnings

## Environment Configuration

### Required Variables
```bash
# Blockchain
RPC_URL=https://sepolia.base.org
REWARD_POOL_FACTORY_ADDRESS=0x...
CLAIM_ROUTER_ADDRESS=0x...
PUBLISHER_ADDRESS=0x...  # Public address only

# Services
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DB_URI=mongodb://...
```

### Security Notes
- No private keys in environment variables
- Contract addresses are public information
- Publisher address is public for signature verification

## API Response Format

### Transaction Preparation Response
```json
{
  "success": true,
  "data": {
    "contractAddress": "0x...",
    "abi": ["function signature"],
    "functionName": "methodName",
    "args": ["param1", "param2"],
    "validations": {
      "tokenAllowed": true,
      "poolExists": false
    }
  }
}
```

### EIP-712 Signature Preparation
```json
{
  "success": true,
  "data": {
    "domain": {
      "name": "FactoryVault",
      "version": "1",
      "chainId": 84532,
      "verifyingContract": "0x..."
    },
    "types": { "Claim": [...] },
    "message": { "account": "0x...", ... },
    "publisherAddress": "0x..."
  }
}
```

## Testing

### Test Structure
- **Unit Tests**: Service layer logic
- **Integration Tests**: API endpoints with mocked blockchain
- **Security Tests**: Authentication and validation flows

### Test Environment
- MongoDB Memory Server for isolated database tests
- ioredis-mock for Redis testing
- Supertest for API endpoint testing
- Mock blockchain services for deterministic testing

## Development Workflow

### Local Development
```bash
# Start all services
docker compose up -d

# Run in development mode
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test
```

### Production Build
```bash
# Build application
npm run build

# Start production server
npm start
```

## Key Design Principles

1. **Security First**: No server-side private keys, client-side signing
2. **Validation Heavy**: Extensive parameter and state validation
3. **Gas Awareness**: Cost estimation and expense warnings
4. **Session-Based**: Secure token-based authentication
5. **Preparation Pattern**: Prepare data for client execution vs server execution
6. **EIP-712 Compliance**: Standard wallet integration patterns

This architecture ensures maximum security while maintaining a smooth user experience through careful transaction preparation and validation.