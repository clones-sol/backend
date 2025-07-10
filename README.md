# Backend Server

This is the backend server for Clones. It handles database operations and API endpoints through a Docker container.

## Development

The backend runs in a Docker container. Use docker-compose to manage the service:

```bash
# Start the services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Execute commands in container
docker exec backend npm run <command>

# Stop services
docker-compose down
