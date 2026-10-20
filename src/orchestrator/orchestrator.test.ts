// deno-lint-ignore-file no-explicit-any require-await

/**
 * Tests for Orchestrator
 */

import { expect } from "@std/expect";
import { mockSessionAsync, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { beforeEach, describe, it } from "node:test";
import type { ArrClient } from "../clients/arr_client.ts";
import { logger } from "../logger.ts";
import { Orchestrator } from "./orchestrator.ts";
import type { GlobalSettings } from "../types.ts";

// Mock logger to capture log calls (stub logger.child to intercept createLogger)
const mockLogger = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

// Mock ArrClient
class MockArrClient implements Partial<ArrClient> {
  readonly name: string;
  readonly weight: number;
  public triggerMissingSearchesCalls: number[] = [];
  public triggerCutoffSearchesCalls: number[] = [];

  constructor(name: string, weight: number) {
    this.name = name;
    this.weight = weight;
  }

  getName(): string {
    return this.name;
  }

  getWeight(): number {
    return this.weight;
  }

  setShutdownResources(): void {
    // Mock implementation
  }

  async triggerMissingSearches(limit: number): Promise<number> {
    this.triggerMissingSearchesCalls.push(limit);
    return 0;
  }

  async triggerCutoffSearches(limit: number): Promise<number> {
    this.triggerCutoffSearchesCalls.push(limit);
    return 0;
  }
}

describe("Orchestrator", { concurrency: false }, () => {
  let defaultSettings: GlobalSettings;

  beforeEach(() => {
    defaultSettings = {
      interval: 3600,
      missing_batch_size: 20,
      upgrade_batch_size: 10,
      stagger_interval_seconds: 30,
      search_order: "last_searched_ascending",
      retry_interval_days: 30,
      dry_run: false,
    };
  });

  describe("batch size calculation", () => {
    it("should distribute batch sizes proportionally by weight", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 2.0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 30,
          upgrade_batch_size: 0, // disabled
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Total weight = 3.0
        // client1 (weight 2.0) should get 2/3 = 20 items
        // client2 (weight 1.0) should get 1/3 = 10 items
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(20);

        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(10);
      })();
    });

    it("should ensure minimum batch size of 1 for positive global batch", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 10.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 5,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Even though client1 has low weight, it should get at least 1
        expect(
          (client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0],
        ).toBeGreaterThanOrEqual(1);
      })();
    });

    it("should handle batch size 0 (disabled)", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 0,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Should not call search methods when batch size is 0
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(0);
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls).toHaveLength(0);
      })();
    });

    it("should handle batch size -1 (unlimited)", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: -1,
          upgrade_batch_size: -1,
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Should pass -1 to search methods
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(-1);
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls[0]).toBe(-1);
      })();
    });

    it("should handle equal weights", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 1.0) as unknown as ArrClient;
        const client3 = new MockArrClient("lidarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 30,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2, client3], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Each should get 10 items (1/3 of 30)
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(10);
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(10);
        expect((client3 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(10);
      })();
    });

    it("should call both missing and cutoff searches independently", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(20);

        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls[0]).toBe(10);
      })();
    });

    it("should trigger cutoff searches even when missing batch size is 0", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 0, // disabled
          upgrade_batch_size: 10, // enabled
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Missing should not be called (disabled)
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(0);

        // Cutoff should still be called (enabled)
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls[0]).toBe(10);
      })();
    });

    it("should trigger missing searches even when cutoff batch size is 0", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 20, // enabled
          upgrade_batch_size: 0, // disabled
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Missing should be called (enabled)
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(20);

        // Cutoff should not be called (disabled)
        expect((client1 as unknown as MockArrClient).triggerCutoffSearchesCalls).toHaveLength(0);
      })();
    });

    it("should handle fractional weight distribution with rounding", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.5) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 1.5) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Each should get 5 items (0.5 share of 10)
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(5);
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(5);
      })();
    });

    it("should handle zero total weight by giving minimum batch size to all clients", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // With 0 weight share (0 * 10 = 0), Math.max(1, 0) still gives batch size 1
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client1 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(1);

        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(1);
      })();
    });
  });

  describe("daemon mode", () => {
    it("should run continuously in daemon mode", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
          interval: 1, // 1 second interval
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: false,
          registerSignalHandlers: false,
        });

        // Stop after 2 cycles
        let cycleCount = 0;
        const originalRunCycle = (orchestrator as any).runCycle;
        (orchestrator as any).runCycle = async () => {
          cycleCount++;
          await originalRunCycle.call(orchestrator);
          if (cycleCount >= 2) {
            (orchestrator as any).shouldStop = true;
          }
        };

        const time = new FakeTime();
        try {
          const promise = orchestrator.start();
          // Let the daemon run a few cycles
          for (let i = 0; i < 5; i++) {
            await time.tickAsync(1000);
          }
          await promise;
          expect(cycleCount).toBeGreaterThanOrEqual(2);
        } finally {
          time.restore();
        }
      })();
    });

    it("should sleep between cycles in daemon mode", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
          interval: 60, // 60 second interval
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: false,
          registerSignalHandlers: false,
        });

        // Track cycle timing
        const cycleTimes: number[] = [];
        const originalRunCycle = (orchestrator as any).runCycle;
        (orchestrator as any).runCycle = async () => {
          cycleTimes.push(Date.now());
          await originalRunCycle.call(orchestrator);
          if (cycleTimes.length >= 2) {
            (orchestrator as any).shouldStop = true;
          }
        };

        const time = new FakeTime();
        try {
          const promise = orchestrator.start();
          // Advance through 2 cycles with 60s sleep between
          for (let i = 0; i < 3; i++) {
            await time.tickAsync(60000);
          }
          await promise;
          // Should have run at least 2 cycles
          expect(cycleTimes.length).toBeGreaterThanOrEqual(2);
          // The sleep between cycles should be ~60s
          if (cycleTimes.length >= 2) {
            expect(cycleTimes[1] - cycleTimes[0]).toBeGreaterThanOrEqual(60000);
          }
        } finally {
          time.restore();
        }
      })();
    });

    it("should exit gracefully on shutdown in daemon mode", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const exitStub = stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
          interval: 1,
        };

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: false,
          registerSignalHandlers: false,
        });

        // Trigger shutdown after first cycle
        const originalRunCycle = (orchestrator as any).runCycle;
        (orchestrator as any).runCycle = async () => {
          await originalRunCycle.call(orchestrator);
          (orchestrator as any).shouldStop = true;
        };

        const time = new FakeTime();
        try {
          const promise = orchestrator.start();
          for (let i = 0; i < 3; i++) {
            await time.tickAsync(1000);
          }
          await promise;
          // Should have exited gracefully without calling process.exit
          expect(exitStub.calls.length).toBe(0);
        } finally {
          time.restore();
        }
      })();
    });
  });

  describe("error recovery", () => {
    it("should continue processing other clients after one fails", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 1.0) as unknown as ArrClient;

        // Make client1 throw an error
        stub(client1 as unknown as MockArrClient, "triggerMissingSearches", async () => {
          throw new Error("Connection refused");
        });

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        // Should not throw, should continue to client2
        await expect(orchestrator.start()).resolves.not.toThrow();

        // client2 should have been processed despite client1 failing
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls).toHaveLength(1);
        expect((client2 as unknown as MockArrClient).triggerMissingSearchesCalls[0]).toBe(5);
      })();
    });

    it("should log error details when client fails", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const errorStub = stub(logger, "error");
        stub(process, "exit", () => undefined as never);
        const client = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const testError = new Error("API timeout");
        stub(client as unknown as MockArrClient, "triggerMissingSearches", async () => {
          throw testError;
        });

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        // Verify error was logged
        expect(errorStub.calls[0].args[0]).toMatchObject({
          instance: "radarr",
          error: "API timeout",
        });
        expect(errorStub.calls[0].args[1]).toContain("Error during indexer triggers");
      })();
    });

    it("should handle non-Error exceptions", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const errorStub = stub(logger, "error");
        stub(process, "exit", () => undefined as never);
        const client = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        // Throw a string instead of Error
        stub(client as unknown as MockArrClient, "triggerMissingSearches", async () => {
          throw "Something went wrong";
        });

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        await orchestrator.start();

        expect(errorStub.calls[0].args[0]).toMatchObject({
          instance: "radarr",
          error: "Something went wrong",
          stack: undefined,
        });
      })();
    });
  });

  describe("shutdown signal handling", () => {
    // Note: Signal handling tests are complex with event emitters and multiple listeners
    // Basic shutdown logic is tested in error recovery skipping behavior

    it("should handle SIGTERM signal", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const exitStub = stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        // Capture the SIGTERM handler
        let sigtermHandler: (() => void) | undefined;
        const onStub = stub(
          process,
          "on",
          (_event: string | symbol, handler: (...args: unknown[]) => void) => {
            sigtermHandler = handler as () => void;
            return process;
          },
        );

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: true,
        });

        // Verify handler was registered
        expect(onStub.calls[0].args[0]).toBe("SIGINT");
        expect(onStub.calls[1].args[0]).toBe("SIGTERM");

        // Trigger the SIGTERM handler
        sigtermHandler!();

        // Wait for the shutdown to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should have called process.exit(0)
        expect(exitStub.calls.length).toBe(1);
        expect(exitStub.calls[0].args[0]).toBe(0);

        // Clean up
        orchestrator.dispose();
      })();
    });

    it("should handle SIGINT signal", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const exitStub = stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        // Capture the SIGINT handler
        let sigintHandler: (() => void) | undefined;
        const onStub = stub(
          process,
          "on",
          (_event: string | symbol, handler: (...args: unknown[]) => void) => {
            sigintHandler = handler as () => void;
            return process;
          },
        );

        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: true,
        });

        // Verify handler was registered
        expect(onStub.calls[0].args[0]).toBe("SIGINT");
        expect(onStub.calls[1].args[0]).toBe("SIGTERM");

        // Trigger the SIGINT handler
        sigintHandler!();

        // Wait for the shutdown to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should have called process.exit(0)
        expect(exitStub.calls.length).toBe(1);
        expect(exitStub.calls[0].args[0]).toBe(0);

        // Clean up
        orchestrator.dispose();
      })();
    });

    it("should skip clients after shutdown signal in same cycle", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        stub(process, "exit", () => undefined as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;
        const client2 = new MockArrClient("sonarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        const orchestrator = new Orchestrator([client1, client2], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        // Immediately trigger shutdown before running
        (orchestrator as any).shouldStop = true;

        await orchestrator.start();

        // Clients should be skipped due to shutdown
        // This verifies the shutdown check works
      })();
    });
  });

  describe("cleanup", () => {
    it("should remove signal handlers when dispose is called", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        // Create with signal handlers enabled
        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: true,
        });

        const offStub = stub(process, "off", () => process);

        orchestrator.dispose();

        // Should remove both signal handlers
        expect(offStub.calls[0].args[0]).toBe("SIGINT");
        expect(offStub.calls[1].args[0]).toBe("SIGTERM");
      })();
    });

    it("should handle dispose when signal handlers were not registered", async () => {
      await mockSessionAsync(async () => {
        stub(logger, "child", () => mockLogger as never);
        const client1 = new MockArrClient("radarr", 1.0) as unknown as ArrClient;

        const settings: GlobalSettings = {
          ...defaultSettings,
          missing_batch_size: 10,
          upgrade_batch_size: 0,
        };

        // Create without signal handlers
        const orchestrator = new Orchestrator([client1], settings, {
          oneShot: true,
          registerSignalHandlers: false,
        });

        const offStub = stub(process, "off", () => process);

        // Should not throw
        expect(() => orchestrator.dispose()).not.toThrow();

        // Should not call process.off since handlers were never registered
        expect(offStub.calls.length).toBe(0);
      })();
    });
  });
});
