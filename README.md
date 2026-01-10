# Clones Backend

Backend server for the Clones AI training platform.

## Tech Stack

- Node.js + Express + TypeScript
- MongoDB with Mongoose ODM
- Redis for sessions and caching
- Docker Compose (MongoDB, Redis, LocalStack S3)
- Blockchain: Ethers.js (Base/Sepolia)
- LLM APIs: Anthropic Claude, OpenAI
- AWS S3 storage (LocalStack local, Tigris production)
- Testing: Vitest with MongoDB Memory Server
- Code Quality: Biome linter/formatter

## Getting Started

1. Copy environment configuration:
```bash
cp .env.example .env
```

2. Generate encryption keys and configure `.env`:
```bash
openssl rand -base64 32  # SESSION_SECRET
```

Add your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY) and other required variables.

3. Create Docker network and start services:
```bash
docker network create clones-network 2>/dev/null || true
docker compose up -d
```

The backend will be available at `http://localhost:8001`.

## Development Commands

```bash
# View logs
docker compose logs -f backend-dev

# Run commands in container
docker exec backend npm run <command>

# Stop services
docker compose down
```

Available npm scripts:
- `npm run dev` - Development server with hot reload
- `npm test` - Run tests
- `npm run typecheck` - Type checking
- `npm run lint` - Check code with Biome
- `npm run lint:fix` - Auto-fix issues
- `npm run build` - Build for production
- `npm start` - Start production server

## Architecture

The backend provides REST APIs for:
- Forge system (AI agent training and competitions)
- Gym environments (training environments)
- Blockchain integration (ERC20 tokens, reward pools)
- Referral system (user referrals and rewards)
- WebSocket support (real-time agent operations)

Key directories:
- `src/api/` - API route handlers
- `src/services/` - Business logic
- `src/models/` - Mongoose schemas
- `src/middleware/` - Express middleware
- `src/types/` - TypeScript definitions

## Security

Private keys are encrypted using AES-256-GCM before storage. The `SESSION_SECRET` environment variable is required. Never commit sensitive values to version control.

The backend follows a transaction preparation model - it prepares transaction data for client-side execution but never stores private keys. All transaction signing is handled client-side via MetaMask.
