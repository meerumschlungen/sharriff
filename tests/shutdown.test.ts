/**
 * Tests for shutdown utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { interruptibleSleep } from '../src/utils/shutdown.js';

describe('Shutdown utilities', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('interruptibleSleep', () => {
    it('should complete normally after the specified delay', async () => {
      const sleepPromise = interruptibleSleep(100, emitter);

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(100);
      await sleepPromise;

      // Sleep should complete successfully
      expect(true).toBe(true);
    });

    it('should interrupt early when shutdown signal is emitted', async () => {
      const sleepPromise = interruptibleSleep(1000, emitter);
      let completed = false;

      sleepPromise.then(() => {
        completed = true;
      });

      // Emit shutdown signal after 50ms
      setTimeout(() => emitter.emit('shutdown'), 50);

      await vi.advanceTimersByTimeAsync(50);
      await sleepPromise;

      // Should have completed
      expect(completed).toBe(true);

      // Advancing further shouldn't cause issues
      await vi.advanceTimersByTimeAsync(950);
    });

    it('should return immediately if shutdown is emitted before wait completes', async () => {
      const sleepPromise = interruptibleSleep(1000, emitter);

      // Immediately emit shutdown
      emitter.emit('shutdown');

      await sleepPromise;

      // Should complete without advancing time
      expect(true).toBe(true);
    });

    it('should handle zero delay', async () => {
      const sleepPromise = interruptibleSleep(0, emitter);

      await vi.advanceTimersByTimeAsync(0);
      await sleepPromise;

      // Should complete immediately
      expect(true).toBe(true);
    });

    it('should work with multiple concurrent sleeps', async () => {
      const results: number[] = [];

      const sleep1 = interruptibleSleep(100, emitter).then(() => results.push(1));
      const sleep2 = interruptibleSleep(200, emitter).then(() => results.push(2));
      const sleep3 = interruptibleSleep(300, emitter).then(() => results.push(3));

      // All should complete normally
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all([sleep1, sleep2, sleep3]);

      expect(results).toEqual([1, 2, 3]);
    });

    it('should interrupt all concurrent sleeps on shutdown', async () => {
      const results: string[] = [];

      const sleep1 = interruptibleSleep(1000, emitter).then(() => results.push('sleep1'));
      const sleep2 = interruptibleSleep(2000, emitter).then(() => results.push('sleep2'));
      const sleep3 = interruptibleSleep(3000, emitter).then(() => results.push('sleep3'));

      // Emit shutdown after 100ms
      setTimeout(() => emitter.emit('shutdown'), 100);

      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([sleep1, sleep2, sleep3]);

      // All should have completed via shutdown signal
      expect(results).toHaveLength(3);
      expect(results).toContain('sleep1');
      expect(results).toContain('sleep2');
      expect(results).toContain('sleep3');
    });
  });
});
