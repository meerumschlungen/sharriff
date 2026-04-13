/**
 * Tests for main application entry point
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../src/types.js';

// Mock all dependencies
const mockLoadConfig = vi.fn();
const mockInitialize = vi.fn();
const mockOrchestratorStart = vi.fn();
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

class MockArrClient {
  initialize = mockInitialize;
}

class MockOrchestrator {
  start = mockOrchestratorStart;
}

vi.mock('../src/config/ConfigParser.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../src/clients/ArrClient.js', () => ({
  ArrClient: MockArrClient,
}));

vi.mock('../src/orchestrator/Orchestrator.js', () => ({
  Orchestrator: MockOrchestrator,
}));

vi.mock('../src/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

describe('Main Application', () => {
  let originalArgv: string[];
  let originalExit: typeof process.exit;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Save original values
    originalArgv = process.argv;
    originalExit = process.exit;

    // Reset all mocks
    vi.clearAllMocks();

    // Mock process.exit to prevent actual exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Default mock implementations
    mockInitialize.mockResolvedValue(undefined);
    mockOrchestratorStart.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Restore original values
    process.argv = originalArgv;
    process.exit = originalExit;
    exitSpy.mockRestore();
  });

  describe('warnings', () => {
    it('should warn when retry_interval_days is configured', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 7,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        { retry_interval_days: 7 },
        expect.stringContaining('retry_interval_days is configured but not yet implemented')
      );
    });

    it('should warn when random search order is configured', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'random',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ search_order: 'random' }),
        expect.stringContaining('random search order is configured but not yet fully implemented')
      );
    });

    it('should not warn when retry_interval_days is 0', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ retry_interval_days: expect.any(Number) }),
        expect.stringContaining('retry_interval_days')
      );
    });
  });

  describe('error handling', () => {
    it('should exit with error when no enabled instances found', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: false,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'No enabled instances found. Add at least one enabled instance to proceed.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit with error when loadConfig throws', async () => {
      const error = new Error('Config file not found');
      mockLoadConfig.mockImplementation(() => {
        throw error;
      });

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          error: 'Config file not found',
          stack: expect.any(String),
        },
        'Failed to start Sharriff'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit with error when client initialization fails', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);
      mockInitialize.mockRejectedValue(new Error('Connection failed'));

      const { main } = await import('../src/index.js');
      await main();

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          error: 'Connection failed',
          stack: expect.any(String),
        },
        'Failed to start Sharriff'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('client initialization', () => {
    it('should initialize enabled clients and skip disabled ones', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'radarr-key',
            enabled: true,
            weight: 1.0,
          },
          sonarr: {
            type: 'sonarr',
            host: 'http://sonarr:8989',
            api_key: 'sonarr-key',
            enabled: false,
            weight: 1.0,
          },
          lidarr: {
            type: 'lidarr',
            host: 'http://lidarr:8686',
            api_key: 'lidarr-key',
            enabled: true,
            weight: 2.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      // Should log that sonarr is disabled
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { instance: 'sonarr' },
        'Instance disabled, skipping'
      );

      // Should log clients initialized successfully
      expect(mockLogger.info).toHaveBeenCalledWith(
        { clientCount: 2 },
        'Clients initialized successfully'
      );
    });
  });

  describe('configuration logging', () => {
    it('should log configuration without API keys', async () => {
      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: true,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'secret-key-should-not-appear',
            enabled: true,
            weight: 1.5,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      // Should log config without api_key
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          global: config.global,
          instances: {
            radarr: {
              type: 'radarr',
              host: 'http://radarr:7878',
              enabled: true,
              weight: 1.5,
            },
          },
        },
        'Configuration loaded'
      );

      // Verify API key is not in any log call
      const allLogCalls = [
        ...mockLogger.info.mock.calls,
        ...mockLogger.debug.mock.calls,
        ...mockLogger.warn.mock.calls,
        ...mockLogger.error.mock.calls,
      ];

      const hasSecretKey = allLogCalls.some((call) =>
        JSON.stringify(call).includes('secret-key-should-not-appear')
      );
      expect(hasSecretKey).toBe(false);
    });
  });

  describe('orchestrator', () => {
    it('should start orchestrator in one-shot mode when --once flag is present', async () => {
      process.argv = ['node', 'index.js', '--once'];

      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockOrchestratorStart).toHaveBeenCalled();
    });

    it('should start orchestrator in daemon mode when --once flag is not present', async () => {
      process.argv = ['node', 'index.js'];

      const config: Config = {
        global: {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 30,
          search_order: 'last_searched_ascending',
          retry_interval_days: 0,
          dry_run: false,
        },
        instances: {
          radarr: {
            type: 'radarr',
            host: 'http://radarr:7878',
            api_key: 'test-key',
            enabled: true,
            weight: 1.0,
          },
        },
      };

      mockLoadConfig.mockReturnValue(config);

      const { main } = await import('../src/index.js');
      await main();

      expect(mockOrchestratorStart).toHaveBeenCalled();
    });
  });
});
