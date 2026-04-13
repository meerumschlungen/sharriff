/**
 * Orchestrator - Manages search cycles across multiple *arr instances
 */

import type { ArrClient } from '../clients/ArrClient.js';
import type { GlobalSettings } from '../types.js';
import { logger } from '../logger.js';
import { interruptibleSleep } from '../utils/shutdown.js';
import { EventEmitter } from 'events';
import { Mutex } from 'async-mutex';

export interface OrchestratorOptions {
  oneShot?: boolean; // If true, run once and exit. If false, run continuously
}

export class Orchestrator {
  private clients: ArrClient[];
  private settings: GlobalSettings;
  private options: OrchestratorOptions;
  private shouldStop = false;
  private shutdownEmitter = new EventEmitter();
  private workMutex = new Mutex();

  constructor(clients: ArrClient[], settings: GlobalSettings, options: OrchestratorOptions = {}) {
    this.clients = clients;
    this.settings = settings;
    this.options = options;

    // Inject shutdown resources into clients
    for (const client of clients) {
      client.setShutdownResources(this.workMutex, this.shutdownEmitter);
    }

    // Setup graceful shutdown handlers
    process.on('SIGINT', () => {
      void this.handleShutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void this.handleShutdown('SIGTERM');
    });
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
    logger.info('Starting indexer trigger cycle');

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

        await client.triggerMissingSearches(clientBatchSize);

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
        await client.triggerCutoffSearches(cutoffBatchSize);
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

    // Wait for in-flight operations (max 30s)
    await Promise.race([
      this.workMutex.waitForUnlock(),
      new Promise((resolve) => setTimeout(resolve, 30000)),
    ]);
    logger.info('Exiting gracefully');
    process.exit(0);
  }
}
