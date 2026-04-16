# Sharriff

Minimal TypeScript orchestration service for managing automated searches across multiple \*arr instances (Radarr, Sonarr, Lidarr, Whisparr).

## Features

- ✅ Multi-instance support (Radarr, Sonarr, Lidarr, Whisparr)
- ✅ Missing item searches (items not yet downloaded)
- ✅ Cutoff unmet searches (upgrade items that haven't reached quality cutoff)
- ✅ Weighted distribution for prioritizing instances
- ✅ Configurable stagger delays to prevent API overload
- ✅ Server-side search ordering (8 sort options)
- ✅ Structured logging (JSON in production, pretty in development)
- ✅ Dry run mode for safe testing
- ✅ Daemon and one-shot execution modes
- ✅ Graceful shutdown handling (SIGINT/SIGTERM)
- ✅ Built with modern TypeScript best practices (2026)

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run once and exit
SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js --once

# Run as daemon (continuous loop)
SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js
```

## Docker

Sharriff is available as a Docker container with multi-stage builds for optimal size and security.

See [docker/README.md](docker/README.md) for detailed Docker documentation.

### Quick Start with Docker

```bash
# Build the image
docker build -f docker/Dockerfile -t sharriff:latest .

# Run with docker
docker run -d \
  --name sharriff \
  -v $(pwd)/config.yaml:/config/sharriff.yaml:ro \
  -e LIDARR_API_KEY=your_key \
  -e SONARR_API_KEY=your_key \
  -e RADARR_API_KEY=your_key \
  sharriff:latest
```

### Docker Compose

The recommended way to run Sharriff:

```bash
# Start the service
docker compose -f docker/compose.yaml up -d

# View logs
docker compose -f docker/compose.yaml logs -f sharriff

# Stop the service
docker compose -f docker/compose.yaml down
```

For more details, see [docker/README.md](docker/README.md).

## Configuration

Sharriff requires a YAML configuration. You can provide it in two ways:

1. **`SHARRIFF_CONFIG`** - Raw YAML configuration as an environment variable (takes priority)
2. **`SHARRIFF_CONFIG_FILE`** - Path to a YAML configuration file

If both are set, `SHARRIFF_CONFIG` takes precedence.

### Configuration via File (SHARRIFF_CONFIG_FILE)

The traditional approach using a configuration file:

```bash
export SHARRIFF_CONFIG_FILE="./config.yaml"
npm start
```

### Configuration via Environment Variable (SHARRIFF_CONFIG)

For cloud-native deployments (Kubernetes, serverless, CI/CD), you can provide the entire configuration as a raw YAML string:

```bash
export SHARRIFF_CONFIG='
global:
  interval: 3600
  missing_batch_size: 20
  upgrade_batch_size: 10

instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: ${RADARR_API_KEY}
'

npm start
```

**Kubernetes ConfigMap Example:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: sharriff-config
data:
  config.yaml: |
    global:
      interval: 3600
      missing_batch_size: 20
    instances:
      radarr:
        type: radarr
        host: http://radarr:7878
        api_key: ${RADARR_API_KEY}
---
apiVersion: v1
kind: Pod
metadata:
  name: sharriff
spec:
  containers:
  - name: sharriff
    image: sharriff:latest
    env:
    - name: SHARRIFF_CONFIG
      valueFrom:
        configMapKeyRef:
          name: sharriff-config
          key: config.yaml
    - name: RADARR_API_KEY
      valueFrom:
        secretKeyRef:
          name: arr-secrets
          key: radarr-api-key
```

### Environment Variable Interpolation

Sharriff supports environment variable interpolation in configuration files using `${VARIABLE_NAME}` syntax. This is useful for keeping sensitive credentials (like API keys) out of version control:

**1. Create a `.env` file:**

```bash
# Copy the example template
cp .env.example .env

# Edit with your actual credentials
LIDARR_API_KEY=your_actual_lidarr_key
SONARR_API_KEY=your_actual_sonarr_key
RADARR_API_KEY=your_actual_radarr_key
```

**2. Reference variables in your config file:**

```yaml
instances:
  radarr:
    type: radarr
    host: 'http://radarr:7878'
    api_key: ${RADARR_API_KEY}

  sonarr:
    type: sonarr
    host: 'http://sonarr:8989'
    api_key: ${SONARR_API_KEY}
```

**3. Run with environment variables loaded:**

```bash
# Environment variables are automatically loaded from .env
npm run dev   # or npm start
```

**Notes:**

- Variables are interpolated **before** YAML parsing
- All configuration fields support interpolation (not just API keys)
- Plain strings without `${}` work normally (backward compatible)
- Throws a descriptive error if a referenced variable is undefined
- The `.env` file is gitignored by default; `.env.example` is provided as a template

### Configuration Options

See `config.example.yaml` for all available configuration options.

**Required Settings:**

- `instances`: At least one \*arr instance must be defined with `type`, `host`, and `api_key`

**Optional Global Settings (with defaults):**

- `interval: 3600` - Run interval in seconds (daemon mode only)
- `missing_batch_size: 20` - Missing items per cycle (0=disabled, -1=unlimited, N>0=limit)
- `upgrade_batch_size: 10` - Cutoff unmet items per cycle (0=disabled, -1=unlimited, N>0=limit)
- `stagger_interval_seconds: 30` - Delay between individual searches
- `search_order: last_searched_ascending` - Search ordering strategy
- `retry_interval_days: 30` - Days before retrying (not yet implemented)
- `dry_run: false` - Test mode (logs commands without executing)

**Optional Instance Settings:**

- `enabled: true` - Enable/disable instance
- `weight: 1.0` - Relative priority (higher = more items)

## Logging

Sharriff uses structured logging with automatic format switching based on environment:

### Log Format

The log format is controlled by the `LOG_FORMAT` environment variable:

- `pretty` - Human-readable, colorized output (default in development)
- `json` - Structured JSON logs (default in production)

### Development Mode (Human-Readable)

Set `NODE_ENV=development` for pretty, colored logs with timestamps (or use `LOG_FORMAT=pretty`):

```bash
NODE_ENV=development SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js --once
```

Example output:

```
[2026-04-10 11:57:42] INFO: Configuration loaded
    global: {
      "interval": 3600,
      "missing_batch_size": 20,
      ...
    }
[2026-04-10 11:57:42] INFO: Connected to *arr instance
    instance: "radarr"
    version: "6.1.1.10360"
```

### Production Mode (JSON)

Set `NODE_ENV=production` for structured JSON logs suitable for log aggregation (or use `LOG_FORMAT=json`):

```bash
NODE_ENV=production SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js
```

Example output:

```json
{
  "level": 30,
  "time": "2026-04-10T11:58:13.220Z",
  "service": "sharriff",
  "instance": "radarr",
  "version": "6.1.1.10360",
  "msg": "Connected to *arr instance"
}
```

### Override Format

You can override the default format regardless of NODE_ENV:

```bash
# Force JSON format in development
NODE_ENV=development LOG_FORMAT=json SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js

# Force pretty format in production
NODE_ENV=production LOG_FORMAT=pretty SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js
```

### Log Levels

Control verbosity with the `LOG_LEVEL` environment variable:

- `debug` - Show all logs including detailed item processing (default in development)
- `info` - Show informational messages (default in production)
- `warn` - Show warnings and errors only
- `error` - Show errors only

```bash
LOG_LEVEL=warn NODE_ENV=production SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js
```

### Timezone

Control timestamp timezone with the `TZ` environment variable (defaults to UTC):

```bash
# Use local timezone
TZ=Europe/Berlin LOG_FORMAT=pretty SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js

# Use specific timezone
TZ=America/New_York LOG_FORMAT=pretty SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js

# Force UTC (default)
TZ=UTC LOG_FORMAT=pretty SHARRIFF_CONFIG_FILE=config.yaml node dist/index.js
```

**Note:** Timezone conversion only applies to `pretty` format logs. JSON logs always use UTC timestamps (ISO 8601 with 'Z' suffix) as this is the standard for log aggregation systems.

## Testing

Sharriff includes a comprehensive test suite using Vitest:

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

### Test Coverage

The test suite provides comprehensive coverage across all components:

- ✅ Configuration parsing and validation (Zod schemas, env vars)
- ✅ HTTP client with retry logic and error handling
- ✅ Concrete client implementations (Radarr, Sonarr, Lidarr)
- ✅ ArrClient integration (initialize, command, stagger)
- ✅ Orchestrator weighted distribution and error recovery
- ✅ Sort parameter mapping for all search orders
- ✅ Logger environment variable handling

**Current coverage: 86.91% overall** (110 tests)

- Clients: 91.12% (ArrClient 97.77%, concrete clients)
- Configuration parser: 96.55%
- HTTP client: 96.29%
- Orchestrator: 68.42%

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Code quality standards
- Pull request process
- Conventional commit format
- Release workflow

**Quick start for contributors:**

```bash
# Install dependencies
npm install

# Run tests
npm test

# Check everything (type-check, lint, format, tests)
npm run check

# Create a PR with conventional commit title
# Example: "feat: add retry_interval_days implementation"
```

## License

MIT
