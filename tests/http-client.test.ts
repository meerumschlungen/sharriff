/**
 * Tests for HttpClient retry logic and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../src/http/HttpClient.js';
import axios, { AxiosError } from 'axios';

vi.mock('axios');

describe('HttpClient', () => {
  let httpClient: HttpClient;
  const mockCreate = vi.mocked(axios.create);
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock axios instance
    mockAxiosInstance = {
      request: vi.fn(),
    };

    mockCreate.mockReturnValue(mockAxiosInstance);

    httpClient = new HttpClient({
      baseURL: 'http://localhost:7878',
      apiKey: 'test-api-key',
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Successful requests', () => {
    it('should make successful GET request', async () => {
      const mockResponse = { data: { id: 1, name: 'Test' } };
      mockAxiosInstance.request.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.get('/api/v3/system/status');

      expect(result).toEqual({ id: 1, name: 'Test' });
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/api/v3/system/status',
        params: undefined,
      });
    });

    it('should make successful GET request with params', async () => {
      const mockResponse = { data: { records: [] } };
      mockAxiosInstance.request.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.get('/api/v3/wanted/missing', {
        page: 1,
        pageSize: 10,
      });

      expect(result).toEqual({ records: [] });
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/api/v3/wanted/missing',
        params: { page: 1, pageSize: 10 },
      });
    });

    it('should make successful POST request', async () => {
      const mockResponse = { data: { id: 123, name: 'MissingMoviesSearch' } };
      mockAxiosInstance.request.mockResolvedValueOnce(mockResponse);

      const result = await httpClient.post('/api/v3/command', {
        name: 'MissingMoviesSearch',
        movieIds: [1, 2, 3],
      });

      expect(result).toEqual({ id: 123, name: 'MissingMoviesSearch' });
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'POST',
        url: '/api/v3/command',
        data: { name: 'MissingMoviesSearch', movieIds: [1, 2, 3] },
      });
    });
  });

  describe('Client errors (4xx) - no retry', () => {
    it('should fail fast on 400 Bad Request', async () => {
      const error = new AxiosError('Bad Request');
      error.response = {
        status: 400,
        statusText: 'Bad Request',
        data: {},
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockRejectedValueOnce(error);

      await expect(httpClient.get('/api/v3/invalid')).rejects.toThrow(
        'HTTP 400: Bad Request - GET /api/v3/invalid'
      );

      // Should not retry
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('should fail fast on 401 Unauthorized', async () => {
      const error = new AxiosError('Unauthorized');
      error.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: {},
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockRejectedValueOnce(error);

      await expect(httpClient.get('/api/v3/system/status')).rejects.toThrow(
        'HTTP 401: Unauthorized - GET /api/v3/system/status'
      );

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('should fail fast on 404 Not Found', async () => {
      const error = new AxiosError('Not Found');
      error.response = {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockRejectedValueOnce(error);

      await expect(httpClient.get('/api/v3/nonexistent')).rejects.toThrow(
        'HTTP 404: Not Found - GET /api/v3/nonexistent'
      );

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('Server errors (5xx) - retry with backoff', () => {
    it('should retry on 500 Internal Server Error and succeed', async () => {
      const error = new AxiosError('Internal Server Error');
      error.response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: {},
        headers: {},
        config: {} as any,
      };

      const successResponse = { data: { status: 'ok' } };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successResponse);

      const promise = httpClient.get('/api/v3/system/status');

      // Fast-forward through retry delays
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff for retries', async () => {
      const error = new AxiosError('Internal Server Error');
      error.response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: {},
        headers: {},
        config: {} as any,
      };

      const successResponse = { data: { status: 'ok' } };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successResponse);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const promise = httpClient.get('/api/v3/system/status');
      await vi.runAllTimersAsync();
      await promise;

      // Verify exponential backoff delays: 1000ms * 2^0, 1000ms * 2^1
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('retrying in 2000ms'));

      consoleSpy.mockRestore();
    });

    it('should fail after exhausting all retries', async () => {
      const error = new AxiosError('Service Unavailable');
      error.response = {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockRejectedValue(error);

      const promise = httpClient.get('/api/v3/system/status');

      // Prevent unhandled rejection warnings
      promise.catch(() => {});

      // Run timers and wait for all promises to settle
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('HTTP request failed');

      // Initial attempt + 3 retries = 4 total
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(4);
    });
  });

  describe('Rate limiting (429) - retry', () => {
    it('should retry on 429 Too Many Requests', async () => {
      const error = new AxiosError('Too Many Requests');
      error.response = {
        status: 429,
        statusText: 'Too Many Requests',
        data: {},
        headers: {},
        config: {} as any,
      };

      const successResponse = { data: { status: 'ok' } };

      mockAxiosInstance.request.mockRejectedValueOnce(error).mockResolvedValueOnce(successResponse);

      const promise = httpClient.get('/api/v3/system/status');
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('Network errors - retry', () => {
    it('should retry on network error (no response)', async () => {
      const error = new AxiosError('Network Error');
      // No response property = network error
      error.response = undefined;

      const successResponse = { data: { status: 'ok' } };

      mockAxiosInstance.request.mockRejectedValueOnce(error).mockResolvedValueOnce(successResponse);

      const promise = httpClient.get('/api/v3/system/status');
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ status: 'ok' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should fail after retrying network errors', async () => {
      const error = new AxiosError('Network Error');
      error.response = undefined;

      mockAxiosInstance.request.mockRejectedValue(error);

      const promise = httpClient.get('/api/v3/system/status');

      // Prevent unhandled rejection warnings
      promise.catch(() => {});

      // Run timers and wait for all promises to settle
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('HTTP request failed');
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(4);
    });
  });

  describe('Configuration', () => {
    it('should create axios instance with correct config', () => {
      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: 'http://localhost:7878',
        timeout: 30000,
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should use default timeout if not provided', () => {
      vi.clearAllMocks();

      new HttpClient({
        baseURL: 'http://localhost:7878',
        apiKey: 'test-api-key',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: 'http://localhost:7878',
        timeout: 30000, // DEFAULT_TIMEOUT
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should use custom retry settings', () => {
      const customClient = new HttpClient({
        baseURL: 'http://localhost:7878',
        apiKey: 'test-api-key',
        maxRetries: 5,
        retryDelay: 500,
      });

      const error = new AxiosError('Service Unavailable');
      error.response = {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockRejectedValue(error);

      const promise = customClient.get('/api/v3/test');
      vi.runAllTimersAsync();

      // Should retry 5 times + initial attempt = 6 total
      promise.catch(() => {
        expect(mockAxiosInstance.request).toHaveBeenCalledTimes(6);
      });
    });
  });

  describe('Non-Axios errors', () => {
    it('should handle non-AxiosError exceptions', async () => {
      const customError = new Error('Custom error');
      mockAxiosInstance.request.mockRejectedValueOnce(customError);

      await expect(httpClient.get('/api/v3/test')).rejects.toThrow('Custom error');
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });
});
