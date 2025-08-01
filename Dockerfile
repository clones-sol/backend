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
RUN npm ci --include=dev

# Copy application code
COPY . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Final stage for app image
FROM base

ADD https://github.com/clones-sol/pipeline/releases/latest/download/pipeline-linux-x64 /app/pipeline
RUN chmod +x /app/pipeline

# Install runtime dependencies
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=build /app/build /app/build
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 8001
CMD [ "node", "./build/server.js" ]
