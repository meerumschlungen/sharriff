# syntax=docker/dockerfile:1@sha256:2780b5c3bab67f1f76c781860de469442999ed1a0d7992a5efdf2cffc0e3d769

# ===================================
# Builder Stage
# ===================================
FROM node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS builder

WORKDIR /build

# Copy package files
COPY ../package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY ../tsconfig.json ./
COPY ../src ./src

# Build TypeScript to JavaScript
RUN npm run build

# ===================================
# Production Stage
# ===================================
FROM node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files
COPY ../package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /build/dist ./dist

# Create config directory with proper permissions
RUN mkdir -p /config && \
    chown -R node:node /config /app

# Switch to non-root user (node user is built-in to node:alpine)
USER node

# Set production environment
ENV NODE_ENV=production \
    SHARRIFF_CONFIG_FILE=/config/sharriff.yaml

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command - run the application
CMD ["node", "dist/index.js"]
