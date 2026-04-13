import { describe, expect, it } from 'vitest';
import { Mutex } from '../src/utils/mutex';

describe('Mutex', () => {
  describe('acquire and release', () => {
    it('should acquire and release lock', async () => {
      const mutex = new Mutex();

      expect(mutex.isLocked()).toBe(false);

      const release = await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      release();
      expect(mutex.isLocked()).toBe(false);
    });

    it('should queue multiple acquires', async () => {
      const mutex = new Mutex();
      const order: number[] = [];

      // First acquire
      const release1 = await mutex.acquire();
      order.push(1);

      // Second acquire (should wait)
      const promise2 = mutex.acquire().then((release) => {
        order.push(2);
        release();
      });

      // Third acquire (should wait)
      const promise3 = mutex.acquire().then((release) => {
        order.push(3);
        release();
      });

      // Release first lock
      release1();

      // Wait for all to complete
      await Promise.all([promise2, promise3]);

      expect(order).toEqual([1, 2, 3]);
    });

    it('should handle concurrent operations correctly', async () => {
      const mutex = new Mutex();
      let counter = 0;

      const increment = async () => {
        const release = await mutex.acquire();
        try {
          const current = counter;
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 1));
          counter = current + 1;
        } finally {
          release();
        }
      };

      // Run 10 concurrent increments
      await Promise.all(Array.from({ length: 10 }, () => increment()));

      expect(counter).toBe(10);
    });
  });

  describe('waitForUnlock', () => {
    it('should resolve immediately if not locked', async () => {
      const mutex = new Mutex();
      await expect(mutex.waitForUnlock()).resolves.toBeUndefined();
    });

    it('should wait for lock to be released', async () => {
      const mutex = new Mutex();
      const order: number[] = [];

      const release = await mutex.acquire();
      order.push(1);

      const waitPromise = mutex.waitForUnlock().then(() => {
        order.push(2);
      });

      // Release after a short delay
      setTimeout(() => {
        order.push(3);
        release();
      }, 10);

      await waitPromise;

      expect(order).toEqual([1, 3, 2]);
    });

    it('should allow multiple waiters', async () => {
      const mutex = new Mutex();
      const results: number[] = [];

      const release = await mutex.acquire();

      const wait1 = mutex.waitForUnlock().then(() => results.push(1));
      const wait2 = mutex.waitForUnlock().then(() => results.push(2));
      const wait3 = mutex.waitForUnlock().then(() => results.push(3));

      release();

      await Promise.all([wait1, wait2, wait3]);

      expect(results).toHaveLength(3);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
    });
  });

  describe('isLocked', () => {
    it('should return correct lock status', async () => {
      const mutex = new Mutex();

      expect(mutex.isLocked()).toBe(false);

      const release = await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      release();
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle release called multiple times safely', async () => {
      const mutex = new Mutex();
      const release = await mutex.acquire();

      release();
      release(); // Should not cause issues

      expect(mutex.isLocked()).toBe(false);
    });

    it('should handle rapid acquire/release cycles', async () => {
      const mutex = new Mutex();

      for (let i = 0; i < 100; i++) {
        const release = await mutex.acquire();
        release();
      }

      expect(mutex.isLocked()).toBe(false);
    });
  });
});
