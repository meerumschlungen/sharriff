# syntax=docker/dockerfile:1

# ===================================
# Builder Stage
# ===================================
FROM node:24-alpine AS builder

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
FROM node:24-alpine AS production

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
