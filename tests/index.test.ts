/**
 * Tests for main application entry point
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "@std/expect";
import { mockSessionAsync, stub } from "@std/testing/mock";
import { main } from "../src/index.ts";
import type { Config } from "../src/types.ts";
import { logger } from "../src/logger.ts";

// Mock logger to capture log calls (stub logger.child to intercept createLogger)
const mockLogger = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

// Mock classes for DI
class MockArrClient {
  initialize = async () => {};
}

class MockOrchestrator {
  start = async () => {};
}

describe("Main Application", { concurrency: false }, () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe("warnings", () => {
    it("should warn when random search order is configured", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const warnStub = stub(logger, "warn");
        stub(process, "exit", () => undefined as never);

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "random",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "test-key",
              enabled: true,
              weight: 1.0,
            },
          },
        };

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        expect(warnStub.calls[0].args[0]).toMatchObject({ search_order: "random" });
        expect(warnStub.calls[0].args[1]).toContain(
          "random search order is configured but not yet fully implemented",
        );
      })();
    });
  });

  describe("error handling", () => {
    it("should exit with error when no enabled instances found", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const errorStub = stub(logger, "error");
        const exitStub = stub(process, "exit", () => undefined as never);

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "test-key",
              enabled: false,
            },
          },
        };

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        expect(errorStub.calls[0].args[0]).toBe(
          "No enabled instances found. Add at least one enabled instance to proceed.",
        );
        expect(exitStub.calls[0].args[0]).toBe(1);
      })();
    });

    it("should exit with error when loadConfig throws", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const errorStub = stub(logger, "error");
        const exitStub = stub(process, "exit", () => undefined as never);

        const error = new Error("Config file not found");

        await main({
          loadConfig: () => {
            throw error;
          },
          ArrClient: MockArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        expect(errorStub.calls[0].args[0]).toMatchObject({
          error: "Config file not found",
        });
        expect(exitStub.calls[0].args[0]).toBe(1);
      })();
    });

    it("should exit with error when client initialization fails", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const errorStub = stub(logger, "error");
        const exitStub = stub(process, "exit", () => undefined as never);

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "test-key",
              enabled: true,
              weight: 1.0,
            },
          },
        };

        class FailingArrClient {
          initialize = async () => {
            throw new Error("Connection failed");
          };
        }

        await main({
          loadConfig: () => config,
          ArrClient: FailingArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        expect(errorStub.calls[0].args[0]).toMatchObject({
          error: "Connection failed",
        });
        expect(exitStub.calls[0].args[0]).toBe(1);
      })();
    });
  });

  describe("client initialization", () => {
    it("should initialize enabled clients and skip disabled ones", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const debugStub = stub(logger, "debug");
        const infoStub = stub(logger, "info");
        stub(process, "exit", () => undefined as never);

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "radarr-key",
              enabled: true,
              weight: 1.0,
            },
            sonarr: {
              type: "sonarr",
              host: "http://sonarr:8989",
              api_key: "sonarr-key",
              enabled: false,
              weight: 1.0,
            },
            lidarr: {
              type: "lidarr",
              host: "http://lidarr:8686",
              api_key: "lidarr-key",
              enabled: true,
              weight: 2.0,
            },
          },
        };

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        // Should log that sonarr is disabled
        expect(
          debugStub.calls.some((c) =>
            (c.args[0] as Record<string, unknown>)?.instance === "sonarr"
          ),
        ).toBe(true);

        // Should log clients initialized successfully
        expect(
          infoStub.calls.some((c) => (c.args[0] as Record<string, unknown>)?.clientCount === 2),
        ).toBe(true);
      })();
    });
  });

  describe("configuration logging", () => {
    it("should log configuration without API keys", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const infoStub = stub(logger, "info");
        const debugStub = stub(logger, "debug");
        const warnStub = stub(logger, "warn");
        const errorStub = stub(logger, "error");
        stub(process, "exit", () => undefined as never);

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: true,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "secret-key-should-not-appear",
              enabled: true,
              weight: 1.5,
            },
          },
        };

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: MockOrchestrator as never,
        });

        // Should log config without api_key
        const configLog = infoStub.calls.find((c) => c.args[1] === "Configuration loaded");
        expect(configLog).toBeDefined();
        expect(configLog!.args[0]).toEqual({
          global: config.global,
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              enabled: true,
              weight: 1.5,
            },
          },
        });

        // Verify API key is not in any log call
        const allLogCalls = [
          ...infoStub.calls,
          ...debugStub.calls,
          ...warnStub.calls,
          ...errorStub.calls,
        ];

        const hasSecretKey = allLogCalls.some((call) =>
          JSON.stringify(call.args).includes("secret-key-should-not-appear")
        );
        expect(hasSecretKey).toBe(false);
      })();
    });
  });

  describe("orchestrator", () => {
    it("should start orchestrator in one-shot mode when --once flag is present", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        process.argv = ["node", "index.js", "--once"];

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "test-key",
              enabled: true,
              weight: 1.0,
            },
          },
        };

        let started = false;
        class TrackingOrchestrator {
          start = async () => {
            started = true;
          };
        }

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: TrackingOrchestrator as never,
        });

        expect(started).toBe(true);
      })();
    });

    it("should start orchestrator in daemon mode when --once flag is not present", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        process.argv = ["node", "index.js"];

        const config: Config = {
          global: {
            interval: 3600,
            missing_batch_size: 20,
            upgrade_batch_size: 10,
            stagger_interval_seconds: 30,
            search_order: "last_searched_ascending",
            retry_interval_days: 0,
            dry_run: false,
          },
          instances: {
            radarr: {
              type: "radarr",
              host: "http://radarr:7878",
              api_key: "test-key",
              enabled: true,
              weight: 1.0,
            },
          },
        };

        let started = false;
        class TrackingOrchestrator {
          start = async () => {
            started = true;
          };
        }

        await main({
          loadConfig: () => config,
          ArrClient: MockArrClient as never,
          Orchestrator: TrackingOrchestrator as never,
        });

        expect(started).toBe(true);
      })();
    });
  });
});
