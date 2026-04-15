# Sharriff Docker Configuration

This directory contains Docker-related files for running Sharriff in containers.

## Files

- **Dockerfile**: Multi-stage Docker build configuration
- **compose.yaml**: Docker Compose configuration for easy deployment

## Quick Start

### Using Docker Compose (Recommended)

From the project root:

```bash
# Start the service
docker compose -f docker/compose.yaml up -d

# View logs
docker compose -f docker/compose.yaml logs -f sharriff

# Stop the service
docker compose -f docker/compose.yaml down
```

Or from the docker directory:

```bash
cd docker
docker compose up -d
```

### Using Docker CLI

From the project root:

```bash
# Build the image
docker build -f docker/Dockerfile -t sharriff:latest .

# Run the container
docker run -d \
  --name sharriff \
  -v $(pwd)/config.yaml:/config/sharriff.yaml:ro \
  -e LIDARR_API_KEY=your_key \
  -e SONARR_API_KEY=your_key \
  -e RADARR_API_KEY=your_key \
  sharriff:latest
```

## Configuration

Sharriff supports two configuration methods:

### Option 1: Configuration File (SHARRIFF_CONFIG_FILE)

The traditional approach using a mounted configuration file:

1. Create your `.env` file in the project root (copy from `.env.example`)
2. Create your `config.yaml` with your \*arr instance configurations
3. Update `docker/compose.yaml` if needed to customize:
   - Resource limits
   - Volume mounts
   - Network configuration
   - Environment variables

### Option 2: Environment Variable (SHARRIFF_CONFIG)

For cloud-native deployments, provide the raw YAML configuration as an environment variable:

```bash
docker run -d \
  --name sharriff \
  -e SHARRIFF_CONFIG='
global:
  interval: 3600
instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: ${RADARR_API_KEY}
' \
  -e RADARR_API_KEY=your_key \
  sharriff:latest
```

**Note:** If both `SHARRIFF_CONFIG` and `SHARRIFF_CONFIG_FILE` are set, `SHARRIFF_CONFIG` takes precedence.

## Environment Variables

See the main README for full documentation. Key variables:

- `NODE_ENV` - Application mode (production/development)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)
- `LOG_FORMAT` - Log format (json/pretty)
- `TZ` - Timezone (default: UTC)
- `SHARRIFF_CONFIG` - Raw YAML configuration string (takes priority)
- `SHARRIFF_CONFIG_FILE` - Config path (default: /config/sharriff.yaml)

## Image Details

- Base: `node:20-alpine`
- Size: ~53MB (compressed)
- User: `node` (non-root)
- Signal handling: dumb-init
- Architecture: Multi-stage build (builder + production)
