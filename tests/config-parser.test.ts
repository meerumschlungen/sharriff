/**
 * Tests for configuration parser
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseConfig, loadConfig } from '../src/config/ConfigParser.js';
import { readFileSync } from 'fs';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Config Parser', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parse', () => {
    it('should parse valid minimal configuration', () => {
      const yaml = `
global:
  interval: 3600

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "test-key"
`;

      const config = parseConfig(yaml);

      expect(config.global.interval).toBe(3600);
      expect(config.global.missing_batch_size).toBe(20); // default
      expect(config.global.dry_run).toBe(false); // default
      expect(config.instances.radarr).toBeDefined();
      expect(config.instances.radarr.type).toBe('radarr');
      expect(config.instances.radarr.host).toBe('http://radarr:7878');
      expect(config.instances.radarr.api_key).toBe('test-key');
      expect(config.instances.radarr.enabled).toBe(true); // default
      expect(config.instances.radarr.weight).toBe(1.0); // default
    });

    it('should apply default values for optional settings', () => {
      const yaml = `
instances:
  sonarr:
    type: sonarr
    host: "http://sonarr:8989"
    api_key: "test-key"
`;

      const config = parseConfig(yaml);

      expect(config.global.interval).toBe(3600);
      expect(config.global.missing_batch_size).toBe(20);
      expect(config.global.upgrade_batch_size).toBe(10);
      expect(config.global.stagger_interval_seconds).toBe(30);
      expect(config.global.search_order).toBe('last_searched_ascending');
      expect(config.global.retry_interval_days).toBe(0);
      expect(config.global.dry_run).toBe(false);
    });

    it('should parse all arr instance types', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key1"
  sonarr:
    type: sonarr
    host: "http://sonarr:8989"
    api_key: "key2"
  lidarr:
    type: lidarr
    host: "http://lidarr:8686"
    api_key: "key3"
  whisparr:
    type: whisparr
    host: "http://whisparr:6969"
    api_key: "key4"
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.type).toBe('radarr');
      expect(config.instances.sonarr.type).toBe('sonarr');
      expect(config.instances.lidarr.type).toBe('lidarr');
      expect(config.instances.whisparr.type).toBe('whisparr');
    });

    it('should parse custom weights', () => {
      const yaml = `
instances:
  radarr-4k:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
    weight: 2.5
  sonarr:
    type: sonarr
    host: "http://sonarr:8989"
    api_key: "key"
    weight: 0.5
`;

      const config = parseConfig(yaml);

      expect(config.instances['radarr-4k'].weight).toBe(2.5);
      expect(config.instances.sonarr.weight).toBe(0.5);
    });

    it('should parse enabled flag', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
    enabled: false
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.enabled).toBe(false);
    });

    it('should parse all search order options', () => {
      const orders = [
        'alphabetical_ascending',
        'alphabetical_descending',
        'last_added_ascending',
        'last_added_descending',
        'last_searched_ascending',
        'last_searched_descending',
        'release_date_ascending',
        'release_date_descending',
      ];

      orders.forEach((order) => {
        const yaml = `
global:
  search_order: ${order}

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
`;

        const config = parseConfig(yaml);
        expect(config.global.search_order).toBe(order);
      });
    });

    it('should parse batch size -1 (unlimited)', () => {
      const yaml = `
global:
  missing_batch_size: -1
  upgrade_batch_size: -1

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
`;

      const config = parseConfig(yaml);

      expect(config.global.missing_batch_size).toBe(-1);
      expect(config.global.upgrade_batch_size).toBe(-1);
    });

    it('should parse batch size 0 (disabled)', () => {
      const yaml = `
global:
  missing_batch_size: 0
  upgrade_batch_size: 0

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
`;

      const config = parseConfig(yaml);

      expect(config.global.missing_batch_size).toBe(0);
      expect(config.global.upgrade_batch_size).toBe(0);
    });

    it('should throw error for invalid YAML', () => {
      const invalidYaml = `
global:
  interval: not-a-number
`;

      expect(() => parseConfig(invalidYaml)).toThrow();
    });

    it('should throw error for missing instances', () => {
      const yaml = `
global:
  interval: 3600
`;

      expect(() => parseConfig(yaml)).toThrow(/Configuration validation failed/);
    });

    it('should throw error for invalid arr type', () => {
      const yaml = `
instances:
  invalid:
    type: invalid
    host: "http://test:1234"
    api_key: "key"
`;

      expect(() => parseConfig(yaml)).toThrow();
    });

    it('should throw error for missing required fields', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    # missing host and api_key
`;

      expect(() => parseConfig(yaml)).toThrow();
    });

    it('should throw error for negative batch size less than -1', () => {
      const yaml = `
global:
  missing_batch_size: -2

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
`;

      expect(() => parseConfig(yaml)).toThrow();
    });

    it('should throw error for invalid search order', () => {
      const yaml = `
global:
  search_order: invalid_order

instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
`;

      expect(() => parseConfig(yaml)).toThrow();
    });

    it('should throw error for negative weight', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
    weight: -1
`;

      expect(() => parseConfig(yaml)).toThrow();
    });

    it('should throw error for zero weight', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "key"
    weight: 0
`;

      expect(() => parseConfig(yaml)).toThrow();
    });
  });

  describe('load', () => {
    it('should load config from SHARRIFF_CONFIG environment variable', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: "http://radarr:7878"
    api_key: "radarr-key"
`;

      process.env['SHARRIFF_CONFIG'] = yaml;
      delete process.env['SHARRIFF_CONFIG_FILE'];

      const config = loadConfig();

      expect(config.instances.radarr).toBeDefined();
      expect(config.instances.radarr.host).toBe('http://radarr:7878');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('should prioritize SHARRIFF_CONFIG over SHARRIFF_CONFIG_FILE', () => {
      const envYaml = `
instances:
  radarr:
    type: radarr
    host: "http://env.radarr:7878"
    api_key: "env-key"
`;

      const fileYaml = `
instances:
  radarr:
    type: radarr
    host: "http://file.radarr:7878"
    api_key: "file-key"
`;

      process.env['SHARRIFF_CONFIG'] = envYaml;
      process.env['SHARRIFF_CONFIG_FILE'] = '/path/to/config.yaml';
      vi.mocked(readFileSync).mockReturnValue(fileYaml);

      const config = loadConfig();

      expect(config.instances.radarr.host).toBe('http://env.radarr:7878');
      expect(config.instances.radarr.api_key).toBe('env-key');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('should load config from SHARRIFF_CONFIG_FILE environment variable', () => {
      const yaml = `
instances:
  sonarr:
    type: sonarr
    host: "http://sonarr:8989"
    api_key: "sonarr-key"
`;

      delete process.env['SHARRIFF_CONFIG'];
      process.env['SHARRIFF_CONFIG_FILE'] = '/path/to/config.yaml';
      vi.mocked(readFileSync).mockReturnValue(yaml);

      const config = loadConfig();

      expect(config.instances.sonarr).toBeDefined();
      expect(config.instances.sonarr.host).toBe('http://sonarr:8989');
      expect(readFileSync).toHaveBeenCalledWith('/path/to/config.yaml', 'utf-8');
    });

    it('should throw error when neither environment variable is set', () => {
      delete process.env['SHARRIFF_CONFIG'];
      delete process.env['SHARRIFF_CONFIG_FILE'];

      expect(() => loadConfig()).toThrow(
        'Either SHARRIFF_CONFIG or SHARRIFF_CONFIG_FILE environment variable must be set'
      );
    });

    it('should throw error when file cannot be read', () => {
      delete process.env['SHARRIFF_CONFIG'];
      process.env['SHARRIFF_CONFIG_FILE'] = '/nonexistent/config.yaml';
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => loadConfig()).toThrow(
        "Failed to read configuration file '/nonexistent/config.yaml': ENOENT: no such file or directory"
      );
    });

    it('should throw error for invalid YAML in file', () => {
      delete process.env['SHARRIFF_CONFIG'];
      process.env['SHARRIFF_CONFIG_FILE'] = '/path/to/config.yaml';
      vi.mocked(readFileSync).mockReturnValue('invalid: yaml: [[[');

      expect(() => loadConfig()).toThrow('Failed to parse YAML');
    });

    it('should throw error for invalid YAML in environment variable', () => {
      process.env['SHARRIFF_CONFIG'] = 'invalid: yaml: [[[';
      delete process.env['SHARRIFF_CONFIG_FILE'];

      expect(() => loadConfig()).toThrow('Failed to parse YAML');
    });

    it('should throw validation error for empty instances', () => {
      const yaml = `
global:
  interval: 3600

instances: {}
`;

      process.env['SHARRIFF_CONFIG_FILE'] = '/path/to/config.yaml';
      vi.mocked(readFileSync).mockReturnValue(yaml);

      expect(() => loadConfig()).toThrow('At least one instance must be defined');
    });
  });

  describe('environment variable interpolation', () => {
    it('should interpolate ${VAR_NAME} syntax with environment variables', () => {
      process.env['TEST_API_KEY'] = 'my-secret-key';
      process.env['TEST_HOST'] = 'http://test.example.com';

      const yaml = `
instances:
  radarr:
    type: radarr
    host: \${TEST_HOST}
    api_key: \${TEST_API_KEY}
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.host).toBe('http://test.example.com');
      expect(config.instances.radarr.api_key).toBe('my-secret-key');
    });

    it('should support multiple environment variables in same config', () => {
      process.env['RADARR_KEY'] = 'radarr-secret';
      process.env['SONARR_KEY'] = 'sonarr-secret';
      process.env['LIDARR_KEY'] = 'lidarr-secret';
      process.env['WHISPARR_KEY'] = 'whisparr-secret';

      const yaml = `
instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: \${RADARR_KEY}
  sonarr:
    type: sonarr
    host: http://sonarr:8989
    api_key: \${SONARR_KEY}
  lidarr:
    type: lidarr
    host: http://lidarr:8686
    api_key: \${LIDARR_KEY}
  whisparr:
    type: whisparr
    host: http://whisparr:6969
    api_key: \${WHISPARR_KEY}
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.api_key).toBe('radarr-secret');
      expect(config.instances.sonarr.api_key).toBe('sonarr-secret');
      expect(config.instances.lidarr.api_key).toBe('lidarr-secret');
      expect(config.instances.whisparr.api_key).toBe('whisparr-secret');
    });

    it('should throw error for undefined environment variable', () => {
      delete process.env['UNDEFINED_VAR'];

      const yaml = `
instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: \${UNDEFINED_VAR}
`;

      expect(() => parseConfig(yaml)).toThrow(
        "Environment variable 'UNDEFINED_VAR' is not defined"
      );
    });

    it('should work with plain strings (no interpolation)', () => {
      const yaml = `
instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: "plain-key-no-interpolation"
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.api_key).toBe('plain-key-no-interpolation');
    });

    it('should support env vars in any string field', () => {
      process.env['MY_HOST'] = 'http://custom.host';
      process.env['MY_KEY'] = 'custom-key';

      const yaml = `
instances:
  radarr:
    type: radarr
    host: \${MY_HOST}
    api_key: \${MY_KEY}
`;

      const config = parseConfig(yaml);

      expect(config.instances.radarr.host).toBe('http://custom.host');
      expect(config.instances.radarr.api_key).toBe('custom-key');
    });

    it('should interpolate before YAML parsing', () => {
      process.env['INTERVAL_VALUE'] = '7200';

      const yaml = `
global:
  interval: \${INTERVAL_VALUE}

instances:
  radarr:
    type: radarr
    host: http://radarr:7878
    api_key: test
`;

      const config = parseConfig(yaml);

      expect(config.global.interval).toBe(7200);
    });
  });
});
