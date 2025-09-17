FROM node:20.17.0-alpine AS base

LABEL fly_launch_runtime="Node.js"

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S backend -u 1001

# Node.js app lives here
WORKDIR /app

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apk add --no-cache build-base python3 make g++ pkgconfig

# Install node modules
COPY package-lock.json package.json ./
RUN npm install --include=dev

# Copy application code
COPY . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Final stage for app image
FROM base

ARG CQA_VERSION=2.0.2
ADD https://github.com/clones-ai/clones-quality-agent/releases/download/v${CQA_VERSION}/clones-quality-agent-linux-x64 ./clones-quality-agent
RUN chmod +x clones-quality-agent

# Install runtime dependencies and curl for healthcheck
RUN apk add --no-cache ffmpeg curl && \
    chown -R backend:nodejs /app

# Copy built application
COPY --from=build --chown=backend:nodejs /app/build /app/build
COPY --from=build --chown=backend:nodejs /app/node_modules /app/node_modules
# Copy source files for Swagger documentation (esbuild strips comments)
COPY --from=build --chown=backend:nodejs /app/src /app/src
COPY --from=build --chown=backend:nodejs /app/package.json /app

# Switch to non-root user
USER backend

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/api/v1/forge/metadata/health || exit 1

# Start the server by default, this can be overwritten at runtime
EXPOSE 8001
CMD [ "node", "./build/server.js" ]
