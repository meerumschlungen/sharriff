/**
 * HTTP client with retry logic and exponential backoff
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, AxiosError } from 'axios';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpClientConfig {
  baseURL: string;
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

export class HttpClient {
  private client: AxiosInstance;
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: HttpClientConfig) {
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Make HTTP request with retry logic
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.request<T>(config);
        return response.data;
      } catch (error) {
        if (error instanceof AxiosError) {
          // Fail fast for client errors (4xx except 429)
          if (
            error.response?.status &&
            error.response.status >= 400 &&
            error.response.status < 500 &&
            error.response.status !== 429
          ) {
            throw new Error(
              `HTTP ${error.response.status}: ${error.response.statusText} - ${config.method} ${config.url}`,
              { cause: error }
            );
          }

          // Retry for transient errors (5xx, 429, network errors)
          const isTransient =
            !error.response || // network error
            error.response.status === 429 || // rate limit
            error.response.status >= 500; // server error

          if (isTransient && attempt < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempt);
            console.log(
              `Transient error on attempt ${attempt + 1}/${this.maxRetries + 1}, retrying in ${delay}ms...`
            );
            await sleep(delay);
            lastError = error;
            continue;
          }
        }

        // Exhausted retries or non-retryable error
        throw error instanceof AxiosError
          ? new Error(`HTTP request failed: ${error.message}`)
          : error;
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * GET request
   */
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: 'GET', url, params });
  }

  /**
   * POST request
   */
  async post<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', url, data });
  }
}
