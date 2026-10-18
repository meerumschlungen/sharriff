/**
 * Shutdown coordination utilities
 */

import type { EventEmitter } from 'node:events';

/**
 * Interruptible sleep that can be cancelled by shutdown signal
 */
export function interruptibleSleep(ms: number, emitter: EventEmitter): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      emitter.off('shutdown', shutdownHandler);
      resolve();
    }, ms);

    const shutdownHandler = () => {
      clearTimeout(timeoutId);
      resolve();
    };

    emitter.once('shutdown', shutdownHandler);
  });
}
