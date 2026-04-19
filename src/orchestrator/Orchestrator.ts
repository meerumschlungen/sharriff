/**
 * Orchestrator - Manages search cycles across multiple *arr instances
 */

import type { ArrClient } from '../clients/ArrClient.js';
import type { GlobalSettings } from '../types.js';
import { logger } from '../logger.js';
import { interruptibleSleep } from '../utils/shutdown.js';
import { EventEmitter } from 'events';
import { Mutex } from '../utils/mutex.js';
import { randomUUID } from 'crypto';

const GRACEFUL_SHUTDOWN_TIMEOUT = 30000; // 30 seconds - max wait for in-flight operations

export interface OrchestratorOptions {
  oneShot?: boolean; // If true, run once and exit. If false, run continuously
  registerSignalHandlers?: boolean; // If true, register SIGINT/SIGTERM handlers (default: true)
}

export class Orchestrator {
  private clients: ArrClient[];
  private settings: GlobalSettings;
  private options: OrchestratorOptions;
  private shouldStop = false;
  private shutdownEmitter = new EventEmitter();
  private workMutex = new Mutex();
  private sigintHandler?: () => void;
  private sigtermHandler?: () => void;

  constructor(clients: ArrClient[], settings: GlobalSettings, options: OrchestratorOptions = {}) {
    this.clients = clients;
    this.settings = settings;
    this.options = options;

    // Inject shutdown resources into clients
    for (const client of clients) {
      client.setShutdownResources(this.workMutex, this.shutdownEmitter);
    }

    // Setup graceful shutdown handlers (default: enabled)
    if (options.registerSignalHandlers !== false) {
      this.sigintHandler = () => {
        void this.handleShutdown('SIGINT');
      };
      this.sigtermHandler = () => {
        void this.handleShutdown('SIGTERM');
      };
      process.on('SIGINT', this.sigintHandler);
      process.on('SIGTERM', this.sigtermHandler);
    }
  }

  /**
   * Start the orchestration loop
   */
  async start(): Promise<void> {
    if (this.options.oneShot) {
      logger.info({ mode: 'one-shot' }, 'Running in one-shot mode');
      await this.runCycle();
      logger.info('One-shot complete');
    } else {
      logger.info(
        { mode: 'daemon', intervalSeconds: this.settings.interval },
        'Running in daemon mode'
      );
      await this.runDaemon();
    }
  }

  /**
   * Run continuous daemon mode
   */
  private async runDaemon(): Promise<void> {
    while (!this.shouldStop) {
      await this.runCycle();

      if (this.shouldStop) {
        logger.info('Shutdown requested, exiting gracefully');
        break;
      }

      const intervalMinutes = Math.floor(this.settings.interval / 60);
      const intervalSeconds = this.settings.interval % 60;
      const intervalStr =
        intervalMinutes > 0 ? `${intervalMinutes}m ${intervalSeconds}s` : `${intervalSeconds}s`;

      logger.info({ intervalSeconds: this.settings.interval }, `Sleeping for ${intervalStr}`);
      await interruptibleSleep(this.settings.interval * 1000, this.shutdownEmitter);
    }
  }

  /**
   * Run a single search cycle across all clients
   */
  private async runCycle(): Promise<void> {
    const cycleId = randomUUID();
    const cycleStart = Date.now();
    let totalTriggered = 0;
    const instanceStats: { instance: string; missing: number; cutoff: number }[] = [];

    logger.info({ cycleId }, 'Starting indexer trigger cycle');

    const totalWeight = this.clients.reduce((sum, client) => sum + client.weight, 0);

    for (const client of this.clients) {
      if (this.shouldStop) {
        logger.warn({ instance: client.name }, 'Skipping due to shutdown request');
        continue;
      }

      try {
        const weightShare = totalWeight > 0 ? client.weight / totalWeight : 0;
        const clientBatchSize = this.calculateBatchSize(
          this.settings.missing_batch_size,
          weightShare
        );
        const cutoffBatchSize = this.calculateBatchSize(
          this.settings.upgrade_batch_size,
          weightShare
        );

        if (clientBatchSize === 0) {
          logger.debug({ instance: client.name }, 'Missing triggers disabled (batch size = 0)');
          continue;
        }

        logger.info(
          {
            instance: client.name,
            weight: client.weight,
            missingBatch:
              clientBatchSize === 0
                ? 'Disabled'
                : clientBatchSize === -1
                  ? 'Unlimited'
                  : clientBatchSize,
          },
          'Processing instance'
        );

        const missingCount = await client.triggerMissingSearches(clientBatchSize);

        // Also trigger searches for cutoff unmet items
        if (cutoffBatchSize === 0) {
          logger.debug({ instance: client.name }, 'Cutoff triggers disabled (batch size = 0)');
          continue;
        }

        logger.info(
          {
            instance: client.name,
            cutoffBatch:
              cutoffBatchSize === 0
                ? 'Disabled'
                : cutoffBatchSize === -1
                  ? 'Unlimited'
                  : cutoffBatchSize,
          },
          'Processing cutoff unmet items'
        );
        const cutoffCount = await client.triggerCutoffSearches(cutoffBatchSize);

        instanceStats.push({ instance: client.name, missing: missingCount, cutoff: cutoffCount });
        totalTriggered += missingCount + cutoffCount;
      } catch (error) {
        logger.error(
          {
            instance: client.name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
          'Error during indexer triggers, continuing to next instance'
        );
      }
    }

    const cycleDuration = Date.now() - cycleStart;
    logger.info(
      {
        cycleId,
        totalTriggered,
        durationMs: cycleDuration,
        instances: instanceStats,
      },
      'Cycle complete'
    );
  }

  /**
   * Calculate batch size based on global setting and weight share
   */
  private calculateBatchSize(globalBatch: number, weightShare: number): number {
    // 0 = disabled, -1 = unlimited
    if (globalBatch === 0 || globalBatch === -1) {
      return globalBatch;
    }

    // Proportional distribution based on weight
    return Math.max(1, Math.round(globalBatch * weightShare));
  }

  /**
   * Handle shutdown signals
   */
  private async handleShutdown(signal: string): Promise<void> {
    logger.warn({ signal }, 'Shutdown signal received, finishing current operation');
    this.shouldStop = true;
    this.shutdownEmitter.emit('shutdown');

    // Wait for in-flight operations
    await Promise.race([
      this.workMutex.waitForUnlock(),
      new Promise((resolve) => setTimeout(resolve, GRACEFUL_SHUTDOWN_TIMEOUT)),
    ]);
    logger.info('Exiting gracefully');
    process.exit(0);
  }

  /**
   * Clean up signal handlers (useful for tests)
   */
  dispose(): void {
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
    }
    if (this.sigtermHandler) {
      process.off('SIGTERM', this.sigtermHandler);
    }
  }
}
