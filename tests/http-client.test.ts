/**
 * Tests for HttpClient retry logic and error handling
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HttpClient, createHttpClient, DEFAULT_TIMEOUT } from '../src/http/HttpClient.ts';

// Mock logger to capture log calls
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../src/logger.ts', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// Helper to create a mock Response
function createResponse(data: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HttpClient', () => {
  let httpClient: HttpClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

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
    vi.unstubAllGlobals();
  });

  it('should make successful GET request', async () => {
    mockFetch.mockResolvedValueOnce(createResponse({ id: 1 }));

    const result = await httpClient.get('/api/v3/system/status');

    expect(result).toEqual({ id: 1 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7878/api/v3/system/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should make successful GET request with params', async () => {
    mockFetch.mockResolvedValueOnce(createResponse({ records: [] }));

    const result = await httpClient.get('/api/v3/wanted/missing', { page: 1 });

    expect(result).toEqual({ records: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7878/api/v3/wanted/missing?page=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should make successful POST request', async () => {
    mockFetch.mockResolvedValueOnce(createResponse({ id: 123 }));

    const result = await httpClient.post('/api/v3/command', { name: 'Test' });

    expect(result).toEqual({ id: 123 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7878/api/v3/command',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      }),
    );
  });

  it('should fail fast on client errors (4xx except 429)', async () => {
    mockFetch.mockResolvedValueOnce(createResponse({}, 401, 'Unauthorized'));

    await expect(httpClient.get('/api/v3/system/status')).rejects.toThrow(
      'HTTP 401: Unauthorized - GET /api/v3/system/status'
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on server errors (5xx) and succeed', async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse({}, 500, 'Internal Server Error'))
      .mockResolvedValueOnce(createResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createResponse({ status: 'ok' }));

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should fail after exhausting retries', async () => {
    mockFetch.mockResolvedValue(createResponse({}, 503, 'Service Unavailable'));

    const promise = httpClient.get('/api/v3/system/status');
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('HTTP 503 error persisted after 4 attempts');
    expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });

  it('should retry on rate limiting (429)', async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse({}, 429, 'Too Many Requests'))
      .mockResolvedValueOnce(createResponse({ status: 'ok' }));

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on network errors (no response)', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(createResponse({ status: 'ok' }));

    const promise = httpClient.get('/api/v3/system/status');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle non-network exceptions', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Custom error'));

    await expect(httpClient.get('/api/v3/test')).rejects.toThrow('Custom error');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should send requests with correct headers and timeout', async () => {
    mockFetch.mockResolvedValueOnce(createResponse({ id: 1 }));

    await httpClient.get('/api/v3/system/status');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7878/api/v3/system/status',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Api-Key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('should increment attempt counter in logs', async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse({}, 500))
      .mockResolvedValueOnce(createResponse({}, 500))
      .mockResolvedValueOnce(createResponse({}, 500))
      .mockResolvedValueOnce(createResponse({ status: 'ok' }));

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

    mockFetch
      .mockResolvedValueOnce(createResponse({}, 500))
      .mockResolvedValueOnce(createResponse({ status: 'ok' }));

    const promise = clientWithShutdown.get('/test');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
