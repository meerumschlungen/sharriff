/**
 * Simple mutex implementation for mutual exclusion
 * Provides basic lock/unlock functionality without external dependencies
 */
export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  /**
   * Acquire the mutex lock
   * Returns a release function that must be called when done
   * @returns Promise that resolves to a release function
   */
  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.locked = true;

    return () => this.release();
  }

  /**
   * Release the mutex lock
   * Notifies all waiting tasks
   */
  private release(): void {
    this.locked = false;
    // Notify all waiters
    const waiters = this.queue.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  /**
   * Wait for the mutex to be unlocked
   * Does not acquire the lock, just waits until it's available
   * @returns Promise that resolves when the mutex is unlocked
   */
  async waitForUnlock(): Promise<void> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
  }

  /**
   * Check if the mutex is currently locked
   * @returns true if locked, false otherwise
   */
  isLocked(): boolean {
    return this.locked;
  }
}
