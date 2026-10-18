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

import type { EventEmitter } from "node:events";
import { createLogger } from "../logger.ts";
import { interruptibleSleep } from "../utils/shutdown.ts";

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
    component: "HttpClient",
    baseURL: config.baseURL,
  });

  const baseURL = config.baseURL.replace(/\/$/, "");
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const headers = {
    "X-Api-Key": config.apiKey,
    "Content-Type": "application/json",
  };

  /**
   * Build a full URL with query params serialized
   */
  function buildUrl(url: string, params?: Record<string, unknown>): string {
    const fullUrl = `${baseURL}${url}`;
    if (!params) return fullUrl;

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return query ? `${fullUrl}?${query}` : fullUrl;
  }

  /**
   * Wait with exponential backoff and log the retry attempt
   */
  async function backoff(
    attempt: number,
    method: string,
    url: string,
    extra: { status?: number; message?: string },
  ): Promise<void> {
    const delay = Math.min(retryDelay * Math.pow(2, attempt), MAX_RETRY_DELAY);
    logger.warn(
      {
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        retryDelayMs: delay,
        method,
        url,
        ...extra,
      },
      "Transient error, retrying...",
    );

    if (shutdownEmitter) {
      await interruptibleSleep(delay, shutdownEmitter);
    } else {
      await sleep(delay);
    }
  }

  /**
   * Execute an HTTP operation with retry logic
   */
  async function executeWithRetry<T>(
    operation: () => Promise<Response>,
    method: string,
    url: string,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: Response;
      try {
        response = await operation();
      } catch (error: unknown) {
        // fetch rejects with TypeError on network errors and TimeoutError on timeouts.
        // Any other error (e.g. a programming bug) is rethrown as-is.
        const isNetworkError = error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError");
        if (!isNetworkError) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        if (attempt === maxRetries) {
          const attempts = attempt + 1;
          throw new Error(
            `Network error persisted after ${attempts} attempts: ${method} ${url}`,
            { cause: error },
          );
        }

        await backoff(attempt, method, url, {
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const status = response.status;

      // Success (2xx)
      if (response.ok) {
        return (await response.json()) as T;
      }

      // Fail fast for client errors (4xx except 429)
      if (status >= 400 && status < 500 && status !== 429) {
        throw new Error(`HTTP ${status}: ${response.statusText} - ${method} ${url}`);
      }

      // Retryable: 429 or 5xx
      if (attempt === maxRetries) {
        const attempts = attempt + 1;
        throw new Error(
          `HTTP ${status} error persisted after ${attempts} attempts: ${method} ${url}`,
        );
      }

      await backoff(attempt, method, url, { status });
    }

    throw new Error("Unreachable");
  }

  return {
    get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
      return executeWithRetry(
        () =>
          fetch(buildUrl(url, params), {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(timeout),
          }),
        "GET",
        url,
      );
    },

    post<T>(url: string, data?: unknown): Promise<T> {
      return executeWithRetry(
        () =>
          fetch(buildUrl(url), {
            method: "POST",
            headers,
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(timeout),
          }),
        "POST",
        url,
      );
    },
  };
}
