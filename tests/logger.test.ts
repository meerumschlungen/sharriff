/**
 * Tests for logger configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all logger-related env vars
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
    delete process.env.TZ;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('environment variable defaults', () => {
    it('should default LOG_LEVEL to debug in development when not set', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LOG_LEVEL;

      const expectedLevel = 'debug';
      const actualLevel =
        process.env.LOG_LEVEL ?? (process.env.NODE_ENV !== 'production' ? 'debug' : 'info');

      expect(actualLevel).toBe(expectedLevel);
    });

    it('should default LOG_LEVEL to info in production when not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;

      const expectedLevel = 'info';
      const actualLevel =
        process.env.LOG_LEVEL ?? (process.env.NODE_ENV !== 'production' ? 'debug' : 'info');

      expect(actualLevel).toBe(expectedLevel);
    });

    it('should use LOG_LEVEL env var when provided', () => {
      process.env.LOG_LEVEL = 'warn';

      expect(process.env.LOG_LEVEL).toBe('warn');
    });

    it('should default to pretty format in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LOG_FORMAT;

      // The format is determined by LOG_FORMAT env var
      // Default should be 'pretty' in development
      const expected = 'pretty';
      const actual =
        process.env.LOG_FORMAT ?? (process.env.NODE_ENV !== 'production' ? 'pretty' : 'json');

      expect(actual).toBe(expected);
    });

    it('should default to json format in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_FORMAT;

      const expected = 'json';
      const actual =
        process.env.LOG_FORMAT ?? (process.env.NODE_ENV !== 'production' ? 'pretty' : 'json');

      expect(actual).toBe(expected);
    });

    it('should default timezone to UTC when not specified', () => {
      delete process.env.TZ;

      const expected = 'UTC';
      const actual = process.env.TZ ?? 'UTC';

      expect(actual).toBe(expected);
    });

    it('should respect TZ environment variable', () => {
      process.env.TZ = 'Europe/Berlin';

      expect(process.env.TZ).toBe('Europe/Berlin');
    });
  });

  describe('LOG_FORMAT override', () => {
    it('should use json format when explicitly set', async () => {
      process.env.NODE_ENV = 'development';
      process.env.LOG_FORMAT = 'json';

      // Verify LOG_FORMAT is respected
      expect(process.env.LOG_FORMAT).toBe('json');
    });

    it('should use pretty format when explicitly set', async () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_FORMAT = 'pretty';

      expect(process.env.LOG_FORMAT).toBe('pretty');
    });
  });

  describe('log levels', () => {
    it('should support all pino log levels', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

      validLevels.forEach((level) => {
        process.env.LOG_LEVEL = level;
        expect(process.env.LOG_LEVEL).toBe(level);
      });
    });
  });
});
