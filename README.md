# Clones Backend

Backend server for the Clones AI training platform.

## Tech Stack

- Node.js + Express + TypeScript
- MongoDB with Mongoose ODM
- Docker Compose (MongoDB, LocalStack S3)
- Solana blockchain integration
- LLM APIs: Anthropic Claude, OpenAI
- AWS S3 storage

## Getting Started

1. Copy environment configuration:
```bash
cp .env.example .env
```

2. Generate encryption keys and configure `.env`:
```bash
openssl rand -base64 32  # DEPOSIT_KEY_ENCRYPTION_SECRET
openssl rand -base64 16  # DEPOSIT_KEY_ENCRYPTION_SALT
```

Add your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY) and other required variables.

3. Start the services:
```bash
docker-compose up -d
```

The backend will be available at `http://localhost:8001`.

## Development Commands

```bash
# View logs
docker-compose logs -f backend

# Run commands in container
docker exec backend npm run <command>

# Stop services
docker-compose down
```

Available npm scripts:
- `npm run dev` - Development server with hot reload
- `npm test` - Run tests
- `npm run build` - Build for production
- `npm start` - Start production server

## Security Note

Private keys are encrypted using AES-256-GCM before storage. The `DEPOSIT_KEY_ENCRYPTION_SECRET` and `DEPOSIT_KEY_ENCRYPTION_SALT` environment variables are required. Never commit these values to version control.