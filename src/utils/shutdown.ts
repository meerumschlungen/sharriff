/**
 * Shutdown coordination utilities
 */

import type { EventEmitter } from 'events';

/**
 * Interruptible sleep that can be cancelled by shutdown signal
 */
export async function interruptibleSleep(ms: number, emitter: EventEmitter): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
    new Promise<void>((resolve) => emitter.once('shutdown', resolve)),
  ]);
}
