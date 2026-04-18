/**
 * HTTP client with retry logic and capped exponential backoff
 *
 * Features:
 * - Automatic retry for transient errors (5xx, 429, network errors)
 * - Exponential backoff with 60-second cap
 * - Interruptible retry delays for graceful shutdown (when shutdownEmitter provided)
 * - Fast-fail for client errors (4xx except 429)
 * - Structured logging for retry attempts
 * - ~5 minute tolerance for service outages (10 retries)
 *
 * Default configuration:
 * - 10 retries (11 total attempts)
 * - 1 second base delay
 * - Backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, 60s, 60s (~5 min total)
 * - 30 second request timeout
 */

import axios, { AxiosError } from 'axios';
import { createLogger } from '../logger.js';
import { interruptibleSleep } from '../utils/shutdown.js';
import type { EventEmitter } from 'events';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpClientConfig {
  baseURL: string;
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  shutdownEmitter?: EventEmitter; // Optional: makes retry backoff interruptible
}

export interface HttpClient {
  get<T>(url: string, params?: Record<string, unknown>): Promise<T>;
  post<T>(url: string, data?: unknown): Promise<T>;
}

export const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 60000; // 60 seconds cap for exponential backoff

/**
 * Create an HTTP client with automatic retry logic
 *
 * Returns an object with get() and post() methods that automatically
 * retry transient errors with exponential backoff.
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
  const shutdownEmitter = config.shutdownEmitter;
  const logger = createLogger({
    component: 'HttpClient',
    baseURL: config.baseURL,
  });

  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
  });

  /**
   * Execute an HTTP operation with retry logic
   */
  async function executeWithRetry<T>(
    operation: () => Promise<{ data: T }>,
    method: string,
    url: string
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await operation();
        return response.data;
      } catch (error: unknown) {
        if (!(error instanceof AxiosError)) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        const status = error.response?.status;

        // Fail fast for client errors (4xx except 429)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new Error(`HTTP ${status}: ${error.response?.statusText} - ${method} ${url}`, {
            cause: error,
          });
        }

        // Check if retryable: network error, 429, or 5xx
        const isRetryable = !error.response || status === 429 || (status && status >= 500);

        if (!isRetryable || attempt === maxRetries) {
          const attempts = attempt + 1;
          const errorType = error.response ? `HTTP ${status}` : 'Network';
          throw new Error(
            `${errorType} error persisted after ${attempts} attempts: ${method} ${url}`,
            { cause: error }
          );
        }

        // Retry with exponential backoff
        const delay = Math.min(retryDelay * Math.pow(2, attempt), MAX_RETRY_DELAY);
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            retryDelayMs: delay,
            method,
            url,
            status,
            message: error.message,
          },
          'Transient error, retrying...'
        );

        if (shutdownEmitter) {
          await interruptibleSleep(delay, shutdownEmitter);
        } else {
          await sleep(delay);
        }
      }
    }

    throw new Error('Unreachable');
  }

  return {
    get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
      return executeWithRetry(() => client.get<T>(url, { params }), 'GET', url);
    },

    post<T>(url: string, data?: unknown): Promise<T> {
      return executeWithRetry(() => client.post<T>(url, data), 'POST', url);
    },
  };
}
