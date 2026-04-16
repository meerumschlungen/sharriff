/**
 * Shutdown coordination utilities
 */

import type { EventEmitter } from 'events';

/**
 * Interruptible sleep that can be cancelled by shutdown signal
 */
export async function interruptibleSleep(ms: number, emitter: EventEmitter): Promise<void> {
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
