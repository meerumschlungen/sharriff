/**
 * Sharriff - *arr orchestration service
 * Main entry point
 */

import { loadConfig } from "./config/ConfigParser.ts";
import { ArrClient } from "./clients/ArrClient.ts";
import { Orchestrator } from "./orchestrator/Orchestrator.ts";
import { logger } from "./logger.ts";
import { DEFAULT_SEARCH_ORDER } from "./types.ts";

// Log startup information
const isDevelopment = process.env["NODE_ENV"] !== "production";
const logLevel = process.env["LOG_LEVEL"] ?? (isDevelopment ? "debug" : "info");
const logFormat = process.env["LOG_FORMAT"] ?? (isDevelopment ? "pretty" : "json");
const timezone = process.env["TZ"] ?? "UTC";

logger.info(
  {
    mode: isDevelopment ? "development" : "production",
    logLevel,
    logFormat,
    timezone,
  },
  "Sharriff - Starting up...",
);

interface MainDependencies {
  loadConfig?: typeof loadConfig;
  ArrClient?: typeof ArrClient;
  Orchestrator?: typeof Orchestrator;
}

export async function main(deps: MainDependencies = {}) {
  const {
    loadConfig: loadConfigFn = loadConfig,
    ArrClient: ArrClientClass = ArrClient,
    Orchestrator: OrchestratorClass = Orchestrator,
  } = deps;

  try {
    // Check for one-shot mode flag
    const oneShot = process.argv.includes("--once");

    // Load configuration from environment
    const config = loadConfigFn();

    // Log configuration (excluding sensitive data)
    const logSafeInstances = Object.fromEntries(
      Object.entries(config.instances).map((
        [name, { api_key: _api_key, ...inst }],
      ) => [name, inst]),
    );

    logger.info(
      {
        global: config.global,
        instances: logSafeInstances,
      },
      "Configuration loaded",
    );

    // Warn if random search order is configured (requires client-side filtering)
    if (config.global.search_order === "random") {
      logger.warn(
        { search_order: config.global.search_order, fallback: DEFAULT_SEARCH_ORDER },
        `random search order is configured but not yet fully implemented - falls back to configuration default (${DEFAULT_SEARCH_ORDER}). Requires client-side filtering implementation. See TODO.md for details.`,
      );
    }

    // Initialize clients
    const clients = await Promise.all(
      Object.entries(config.instances)
        .filter(([name, { enabled }]) => {
          if (!enabled) {
            logger.debug({ instance: name }, "Instance disabled, skipping");
          }
          return enabled;
        })
        .map(async ([name, instanceConfig]) => {
          const client = new ArrClientClass(
            instanceConfig.type,
            name,
            instanceConfig.host,
            instanceConfig.api_key,
            config.global,
            instanceConfig.weight,
          );
          await client.initialize();
          return client;
        }),
    );

    if (clients.length === 0) {
      logger.error("No enabled instances found. Add at least one enabled instance to proceed.");
      process.exit(1);
    }

    logger.info({ clientCount: clients.length }, "Clients initialized successfully");

    // Start orchestration (shutdown resources injected in constructor)
    const orchestrator = new OrchestratorClass(clients, config.global, { oneShot });
    await orchestrator.start();
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Failed to start Sharriff",
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
