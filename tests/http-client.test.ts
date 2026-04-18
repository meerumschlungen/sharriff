/**
 * Tests for HttpClient retry logic and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type HttpClient, createHttpClient, DEFAULT_TIMEOUT } from '../src/http/HttpClient.js';
import axios, { AxiosError } from 'axios';
import { EventEmitter } from 'events';

vi.mock('axios');

// Mock logger to capture log calls
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../src/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// Helper to create mock axios errors
function createAxiosError(status?: number, message = 'Error'): AxiosError {
  const error = new AxiosError(message);
  if (status) {
    error.response = {
      status,
      statusText: message,
      data: {},
      headers: {},
      config: {} as any,
    };
  }
  return error;
}

describe('HttpClient', () => {
  let httpClient: HttpClient;
  const mockCreate = vi.mocked(axios.create);
  let mockAxiosInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
    };

    mockCreate.mockReturnValue(mockAxiosInstance);

    httpClient = createHttpClient({
      baseURL: 'http://localhost:7878',
      apiKey: 'test-api-key',
      timeout: DEFAULT_TIMEOUT,
      maxRetries: 3,
      retryDelay: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should make successful GET request', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 1 } });

    const result = await httpClient.get('/api/v3/system/status');

    expect(result).toEqual({ id: 1 });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v3/system/status', {
      params: undefined,
    });
  });

  it('should make successful GET request with params', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { records: [] } });

    const result = await httpClient.get('/api/v3/wanted/missing', { page: 1 });

    expect(result).toEqual({ records: [] });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v3/wanted/missing', {
      params: { page: 1 },
    });
  });

  it('should make successful POST request', async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 123 } });

    const result = await httpClient.post('/api/v3/command', { name: 'Test' });

    expect(result).toEqual({ id: 123 });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v3/command', { name: 'Test' });
  });

  it('should fail fast on client errors (4xx except 429)', async () => {
    mockAxiosInstance.get.mockRejectedValueOnce(createAxiosError(401, 'Unauthorized'));

    await expect(httpClient.get('/api/v3/system/status')).rejects.toThrow(
      'HTTP 401: Unauthorized - GET /api/v3/system/status'
    );

    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('should retry on server errors (5xx) and succeed', async () => {
    mockAxiosInstance.get
      .mockRejectedValueOnce(createAxiosError(500, 'Internal Server Error'))
      .mockRejectedValueOnce(createAxiosError(503, 'Service Unavailable'))
      .mockResolvedValueOnce({ data: { status: 'ok' } });

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
  });

  it('should fail after exhausting retries', async () => {
    mockAxiosInstance.get.mockRejectedValue(createAxiosError(503, 'Service Unavailable'));

    const promise = httpClient.get('/api/v3/system/status');
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('HTTP 503 error persisted after 4 attempts');
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });

  it('should retry on rate limiting (429)', async () => {
    mockAxiosInstance.get
      .mockRejectedValueOnce(createAxiosError(429, 'Too Many Requests'))
      .mockResolvedValueOnce({ data: { status: 'ok' } });

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('should retry on network errors (no response)', async () => {
    mockAxiosInstance.get
      .mockRejectedValueOnce(createAxiosError(undefined, 'Network Error'))
      .mockResolvedValueOnce({ data: { status: 'ok' } });

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('should handle non-AxiosError exceptions', async () => {
    mockAxiosInstance.get.mockRejectedValueOnce(new Error('Custom error'));

    await expect(httpClient.get('/api/v3/test')).rejects.toThrow('Custom error');
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
  });

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

  it('should increment attempt counter in logs', async () => {
    mockAxiosInstance.get
      .mockRejectedValueOnce(createAxiosError(500))
      .mockRejectedValueOnce(createAxiosError(500))
      .mockRejectedValueOnce(createAxiosError(500))
      .mockResolvedValueOnce({ data: { status: 'ok' } });

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogger.warn).toHaveBeenCalledTimes(3);

    const warnCalls = mockLogger.warn.mock.calls;
    expect(warnCalls[0][0]).toMatchObject({ attempt: 1 });
    expect(warnCalls[1][0]).toMatchObject({ attempt: 2 });
    expect(warnCalls[2][0]).toMatchObject({ attempt: 3 });
  });

  it('should use interruptible sleep when shutdownEmitter provided', async () => {
    const mockEmitter = new EventEmitter();
    const clientWithShutdown = createHttpClient({
      baseURL: 'http://localhost:7878',
      apiKey: 'test-api-key',
      maxRetries: 1,
      retryDelay: 1000,
      shutdownEmitter: mockEmitter,
    });

    mockAxiosInstance.get
      .mockRejectedValueOnce(createAxiosError(500))
      .mockResolvedValueOnce({ data: { status: 'ok' } });

    const promise = clientWithShutdown.get('/test');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });
});
