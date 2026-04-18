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
 *
 * Uses axios response interceptor for idiomatic retry handling.
 */

import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
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
 * Check if error is a client error (4xx except 429) - no retry
 */
function isClientError(error: AxiosError): boolean {
  const status = error.response?.status;
  return !!status && status >= 400 && status < 500 && status !== 429;
}

/**
 * Check if error is retryable (5xx, 429, or network error)
 */
function isRetryableError(error: AxiosError): boolean {
  const status = error.response?.status;
  return (
    !error.response || // Network error
    status === 429 || // Rate limit
    (!!status && status >= 500) // Server error
  );
}

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

  // Use WeakMap to track retry counts without mutating config
  const retryCountMap = new WeakMap<InternalAxiosRequestConfig, number>();

  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
  });

  // Configure response interceptor for automatic retry logic
  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      // Check if error is retryable
      if (!(error instanceof AxiosError)) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }

      const originalConfig = error.config!;

      if (!originalConfig) {
        return Promise.reject(new Error('Request configuration missing', { cause: error }));
      }

      // Fail fast for client errors (4xx except 429)
      if (isClientError(error)) {
        const errorMessage = `HTTP ${error.response?.status}: ${error.response?.statusText} - ${originalConfig.method?.toUpperCase()} ${originalConfig.url}`;
        return Promise.reject(new Error(errorMessage, { cause: error }));
      }

      // Get retry count from WeakMap (no mutation!)
      const currentRetries = retryCountMap.get(originalConfig) ?? 0;

      // Check if we should retry
      if (isRetryableError(error) && currentRetries < maxRetries) {
        const nextRetryCount = currentRetries + 1;
        retryCountMap.set(originalConfig, nextRetryCount);

        const delay = Math.min(retryDelay * Math.pow(2, currentRetries), MAX_RETRY_DELAY);

        logger.warn(
          {
            attempt: nextRetryCount,
            maxAttempts: maxRetries + 1,
            retryDelayMs: delay,
            method: originalConfig.method?.toUpperCase(),
            url: originalConfig.url,
            status: error.response?.status,
            message: error.message,
          },
          'Transient error, retrying...'
        );

        // Use interruptible sleep if shutdown emitter available (for graceful shutdown)
        if (shutdownEmitter) {
          await interruptibleSleep(delay, shutdownEmitter);
        } else {
          await sleep(delay);
        }
        return client.request(originalConfig);
      }

      // Exhausted retries
      const errorMessage = error.response
        ? `HTTP ${error.response.status} error persisted after ${currentRetries + 1} attempts: ${originalConfig.method?.toUpperCase()} ${originalConfig.url}`
        : `Network error persisted after ${currentRetries + 1} attempts: ${originalConfig.method?.toUpperCase()} ${originalConfig.url}`;
      return Promise.reject(new Error(errorMessage, { cause: error }));
    }
  );

  // Return public API
  return {
    async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
      const response = await client.get<T>(url, { params });
      return response.data;
    },

    async post<T>(url: string, data?: unknown): Promise<T> {
      const response = await client.post<T>(url, data);
      return response.data;
    },
  };
}
