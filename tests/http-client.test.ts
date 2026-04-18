/**
 * Tests for HttpClient retry logic and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type HttpClient, createHttpClient, DEFAULT_TIMEOUT } from '../src/http/HttpClient.js';
import axios, { AxiosError } from 'axios';

vi.mock('axios');

describe('HttpClient', () => {
  let httpClient: HttpClient;
  const mockCreate = vi.mocked(axios.create);
  let mockAxiosInstance: any;
  let responseInterceptor: any;
  let baseGet: any;
  let basePost: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create base get/post mocks that will be wrapped by interceptor
    baseGet = vi.fn();
    basePost = vi.fn();

    // Create mock axios instance with working interceptors
    mockAxiosInstance = {
      get: baseGet,
      post: basePost,
      request: vi.fn(async (config: any) => {
        // Route to appropriate method based on config
        if (config.method?.toLowerCase() === 'post') {
          return basePost(config.url, config.data, config);
        } else {
          return baseGet(config.url, config);
        }
      }),
      interceptors: {
        response: {
          use: vi.fn((onFulfilled, onRejected) => {
            responseInterceptor = { onFulfilled, onRejected };
            const baseRequestFn = mockAxiosInstance.request;
            // Replace the methods to go through the interceptor
            mockAxiosInstance.get = vi.fn(async (url: string, config?: any) => {
              try {
                const response = await baseGet(url, config);
                return onFulfilled(response);
              } catch (error) {
                return onRejected(error);
              }
            });
            mockAxiosInstance.post = vi.fn(async (url: string, data?: any, config?: any) => {
              try {
                const response = await basePost(url, data, config);
                return onFulfilled(response);
              } catch (error) {
                return onRejected(error);
              }
            });
            // Also wrap request method
            mockAxiosInstance.request = vi.fn(async (config: any) => {
              try {
                const response = await baseRequestFn(config);
                return onFulfilled(response);
              } catch (error) {
                return onRejected(error);
              }
            });
            return 0;
          }),
        },
      },
    };

    mockCreate.mockReturnValue(mockAxiosInstance);

    // Create client - this will set up interceptors
    httpClient = createHttpClient({
      baseURL: 'http://localhost:7878',
      apiKey: 'test-api-key',
      timeout: DEFAULT_TIMEOUT,
      maxRetries: 3,
      retryDelay: 1000,
    });

    // After client is created, mockAxiosInstance.get/post are now the wrapped versions
    // Tests should mock baseGet/basePost, not mockAxiosInstance.get/post
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Successful requests', () => {
    it('should make successful GET request', async () => {
      const mockResponse = { data: { id: 1, name: 'Test' } };
      baseGet.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.get('/api/v3/system/status');

      expect(result).toEqual({ id: 1, name: 'Test' });
      expect(baseGet).toHaveBeenCalledWith('/api/v3/system/status', { params: undefined });
    });

    it('should make successful GET request with params', async () => {
      const mockResponse = { data: { records: [] } };
      baseGet.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.get('/api/v3/wanted/missing', {
        page: 1,
        pageSize: 10,
      });

      expect(result).toEqual({ records: [] });
      expect(baseGet).toHaveBeenCalledWith('/api/v3/wanted/missing', {
        params: { page: 1, pageSize: 10 },
      });
    });

    it('should make successful POST request', async () => {
      const mockResponse = { data: { id: 123, name: 'MissingMoviesSearch' } };
      basePost.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.post('/api/v3/command', {
        name: 'MissingMoviesSearch',
        movieIds: [1, 2, 3],
      });

      expect(result).toEqual({ id: 123, name: 'MissingMoviesSearch' });
      expect(basePost).toHaveBeenCalledWith(
        '/api/v3/command',
        {
          name: 'MissingMoviesSearch',
          movieIds: [1, 2, 3],
        },
        undefined
      );
    });
  });

  describe('Client errors (4xx) - no retry', () => {
    it('should fail fast on 401 Unauthorized', async () => {
      const error = new AxiosError('Unauthorized');
      error.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: {},
        headers: {},
        config: {} as any,
      };
      error.config = { method: 'get', url: '/api/v3/system/status' } as any;

      baseGet.mockRejectedValueOnce(error);

      await expect(httpClient.get('/api/v3/system/status')).rejects.toThrow(
        'HTTP 401: Unauthorized - GET /api/v3/system/status'
      );

      expect(baseGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('Server errors (5xx) - retry with backoff', () => {
    it('should retry on 500 Internal Server Error and succeed', async () => {
      let attemptCount = 0;
      baseGet.mockImplementation(async (url: string, config?: any) => {
        attemptCount++;
        if (attemptCount <= 2) {
          const error = new AxiosError('Internal Server Error');
          error.response = {
            status: 500,
            statusText: 'Internal Server Error',
            data: {},
            headers: {},
            config: {} as any,
          };
          error.config = config;
          throw error;
        }
        return { data: { status: 'ok' } };
      });

      const promise = httpClient.get('/api/v3/system/status');

      // Fast-forward through retry delays
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(baseGet).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retries', async () => {
      baseGet.mockImplementation(async (url: string, config?: any) => {
        const error = new AxiosError('Service Unavailable');
        error.response = {
          status: 503,
          statusText: 'Service Unavailable',
          data: {},
          headers: {},
          config: {} as any,
        };
        error.config = config;
        throw error;
      });

      const promise = httpClient.get('/api/v3/system/status');

      // Prevent unhandled rejection warnings
      promise.catch(() => {});

      // Run timers and wait for all promises to settle
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('HTTP 503 error persisted after 4 attempts');

      // Initial attempt + 3 retries = 4 total
      expect(baseGet).toHaveBeenCalledTimes(4);
    });
  });

  describe('Rate limiting (429) - retry', () => {
    it('should retry on 429 Too Many Requests', async () => {
      let attemptCount = 0;
      baseGet.mockImplementation(async (url: string, config?: any) => {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new AxiosError('Too Many Requests');
          error.response = {
            status: 429,
            statusText: 'Too Many Requests',
            data: {},
            headers: {},
            config: {} as any,
          };
          error.config = config;
          throw error;
        }
        return { data: { status: 'ok' } };
      });

      const promise = httpClient.get('/api/v3/system/status');
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(baseGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('Network errors - retry', () => {
    it('should retry on network error (no response)', async () => {
      let attemptCount = 0;
      baseGet.mockImplementation(async (url: string, config?: any) => {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new AxiosError('Network Error');
          // No response property = network error
          error.response = undefined;
          error.config = config;
          throw error;
        }
        return { data: { status: 'ok' } };
      });

      const promise = httpClient.get('/api/v3/system/status');
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(baseGet).toHaveBeenCalledTimes(2);
    });

    it('should fail after retrying network errors', async () => {
      baseGet.mockImplementation(async (url: string, config?: any) => {
        const error = new AxiosError('Network Error');
        error.response = undefined;
        error.config = config;
        throw error;
      });

      const promise = httpClient.get('/api/v3/system/status');

      // Prevent unhandled rejection warnings
      promise.catch(() => {});

      // Run timers and wait for all promises to settle
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Network error persisted after 4 attempts');
      expect(baseGet).toHaveBeenCalledTimes(4);
    });
  });

  describe('Configuration', () => {
    it('should create axios instance with correct config', () => {
      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: 'http://localhost:7878',
        timeout: DEFAULT_TIMEOUT,
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should use default timeout if not provided', () => {
      vi.clearAllMocks();

      createHttpClient({
        baseURL: 'http://localhost:7878',
        apiKey: 'test-api-key',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: 'http://localhost:7878',
        timeout: DEFAULT_TIMEOUT,
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });
  });

  describe('Non-Axios errors', () => {
    it('should handle non-AxiosError exceptions', async () => {
      const customError = new Error('Custom error');
      baseGet.mockRejectedValueOnce(customError);

      await expect(httpClient.get('/api/v3/test')).rejects.toThrow('Custom error');
      expect(baseGet).toHaveBeenCalledTimes(1);
    });
  });
});
