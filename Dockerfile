FROM node:lts AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

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

ARG CQA_VERSION=2.0.4
ADD https://github.com/clones-ai/clones-quality-agent/releases/download/v${CQA_VERSION}/clones-quality-agent-linux-x64 ./clones-quality-agent
RUN chmod +x clones-quality-agent

# Install runtime dependencies
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=build /app/build /app/build
COPY --from=build /app/node_modules /app/node_modules
# Copy source files for Swagger documentation (esbuild strips comments)
COPY --from=build /app/src /app/src
COPY --from=build /app/package.json /app

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/api/v1/forge/metadata/health || exit 1

# Start the server by default, this can be overwritten at runtime
EXPOSE 8001
CMD [ "node", "./build/server.js" ]
