# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# ===================================
# Builder Stage
# ===================================
FROM denoland/deno:alpine-2.9.4@sha256:13851184d6705150b8b230c5377f26c3bd182865d28700bb72bc0b2c271b504a AS builder

# Point Deno's cache at a known location so it can be copied to the next stage
ENV DENO_DIR=/deno-dir

WORKDIR /build

# Copy manifests first so the dependency install layer caches across source-only edits
COPY deno.json deno.lock package.json package-lock.json ./

# Install production dependencies (skip devDependencies and @types packages)
RUN deno ci --prod --skip-types

# Copy source code
COPY src ./src

# Type-check the source
RUN deno check src/index.ts

# ===================================
# Production Stage
# ===================================
FROM denoland/deno:alpine-2.9.4@sha256:13851184d6705150b8b230c5377f26c3bd182865d28700bb72bc0b2c271b504a AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Point Deno's cache at the same location as the builder
ENV DENO_DIR=/deno-dir

WORKDIR /app

# Copy manifests and source from builder
COPY --from=builder /build/deno.json /build/deno.lock /build/package.json /build/package-lock.json ./
COPY --from=builder /build/src ./src
# Copy the installed node_modules so the runtime does not need to re-create it
COPY --from=builder /build/node_modules ./node_modules
# Copy the populated Deno cache so the runtime stage has the dependencies
COPY --from=builder /deno-dir /deno-dir

# Create config directory with proper permissions
RUN mkdir -p /config && \
    chown -R deno:deno /config /app

# Switch to non-root user (deno user is built-in to denoland/deno images)
USER deno

# Set production environment
ENV NODE_ENV=production \
    SHARRIFF_CONFIG_FILE=/config/sharriff.yaml

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command - run the application with minimal permissions
CMD ["deno", "run", "--allow-env", "--allow-read=/config", "--allow-net", "--allow-sys=hostname", "src/index.ts"]
