# Backend Server

This is the backend server for the Clones project. It manages the database, handles API requests, and powers real-time agent operations.

## Documentation

For complete setup instructions, architectural deep-dives, and contribution guidelines, please refer to the **[Clones Developer Guide](https://docs.page/clones-sol/desktop)**.

Backend-specific details are available in the **[Backend Setup Guide](https://docs.page/clones-sol/desktop/projects/backend)**.

## Quick Start

This guide covers the essential steps to get the backend running locally for development.

### Prerequisites

- [Docker](https://www.docker.com/get-started) installed on your system.

### 1. Clone the Repository

```bash
git clone https://github.com/clones-sol/backend.git
cd backend
```

### 2. Configure Environment

The backend is configured using an `.env` file. Copy the example file to get started:

```bash
cp .env.example .env
```

Next, open the `.env` file and provide the necessary values. Refer to the [Environment Setup section](https://docs.page/clones-sol/desktop/projects/backend#environment-setup) in the documentation for detailed instructions.

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