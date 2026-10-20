/**
 * Tests for HttpClient retry logic and error handling
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "@std/expect";
import { assertSpyCalls, mockSession, resolvesNext, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { type HttpClient, createHttpClient, DEFAULT_TIMEOUT } from "../src/http/HttpClient.ts";
import { logger } from "../src/logger.ts";

// Mock logger to capture log calls (stub logger.child to intercept createLogger)
const mockLogger = {
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
  debug: (..._args: unknown[]) => {},
};

// Helper to create a mock Response
function createResponse(data: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpClient", { concurrency: false }, () => {
  let httpClient: HttpClient;
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
    httpClient = createHttpClient({
      baseURL: "http://localhost:7878",
      apiKey: "test-api-key",
      timeout: DEFAULT_TIMEOUT,
      maxRetries: 3,
      retryDelay: 1000,
    });
  });

  afterEach(() => {
    time.restore();
  });

  it("should make successful GET request", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({ id: 1 }))
      );

      const result = await httpClient.get("/api/v3/system/status");

      expect(result).toEqual({ id: 1 });
      expect(fetchStub.calls[0].args[0]).toBe("http://localhost:7878/api/v3/system/status");
      expect(fetchStub.calls[0].args[1]).toMatchObject({ method: "GET" });
    });
  });

  it("should make successful GET request with params", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({ records: [] }))
      );

      const result = await httpClient.get("/api/v3/wanted/missing", { page: 1 });

      expect(result).toEqual({ records: [] });
      expect(fetchStub.calls[0].args[0]).toBe(
        "http://localhost:7878/api/v3/wanted/missing?page=1",
      );
      expect(fetchStub.calls[0].args[1]).toMatchObject({ method: "GET" });
    });
  });

  it("should make successful POST request", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({ id: 123 }))
      );

      const result = await httpClient.post("/api/v3/command", { name: "Test" });

      expect(result).toEqual({ id: 123 });
      expect(fetchStub.calls[0].args[0]).toBe("http://localhost:7878/api/v3/command");
      expect(fetchStub.calls[0].args[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      });
    });
  });

  it("should fail fast on client errors (4xx except 429)", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({}, 401, "Unauthorized"))
      );

      await expect(httpClient.get("/api/v3/system/status")).rejects.toThrow(
        "HTTP 401: Unauthorized - GET /api/v3/system/status",
      );

      assertSpyCalls(fetchStub, 1);
    });
  });

  it("should retry on server errors (5xx) and succeed", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(
        globalThis,
        "fetch",
        resolvesNext([
          Promise.resolve(createResponse({}, 500, "Internal Server Error")),
          Promise.resolve(createResponse({}, 503, "Service Unavailable")),
          Promise.resolve(createResponse({ status: "ok" })),
        ]),
      );

      const promise = httpClient.get("/api/v3/system/status");
      await time.runAllAsync();

      expect(await promise).toEqual({ status: "ok" });
      assertSpyCalls(fetchStub, 3);
    });
  });

  it("should fail after exhausting retries", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({}, 503, "Service Unavailable"))
      );

      const promise = httpClient.get("/api/v3/system/status");
      promise.catch(() => {});

      await time.runAllAsync();

      await expect(promise).rejects.toThrow("HTTP 503 error persisted after 4 attempts");
      assertSpyCalls(fetchStub, 4); // Initial + 3 retries
    });
  });

  it("should retry on rate limiting (429)", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(
        globalThis,
        "fetch",
        resolvesNext([
          Promise.resolve(createResponse({}, 429, "Too Many Requests")),
          Promise.resolve(createResponse({ status: "ok" })),
        ]),
      );

      const promise = httpClient.get("/api/v3/system/status");
      await time.runAllAsync();

      expect(await promise).toEqual({ status: "ok" });
      assertSpyCalls(fetchStub, 2);
    });
  });

  it("should retry on network errors (no response)", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(
        globalThis,
        "fetch",
        resolvesNext([
          Promise.reject(new TypeError("fetch failed")),
          Promise.resolve(createResponse({ status: "ok" })),
        ]),
      );

      const promise = httpClient.get("/api/v3/system/status");
      await time.runAllAsync();

      expect(await promise).toEqual({ status: "ok" });
      assertSpyCalls(fetchStub, 2);
    });
  });

  it("should handle non-network exceptions", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.reject(new Error("Custom error"))
      );

      await expect(httpClient.get("/api/v3/test")).rejects.toThrow("Custom error");
      assertSpyCalls(fetchStub, 1);
    });
  });

  it("should send requests with correct headers and timeout", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(createResponse({ id: 1 }))
      );

      await httpClient.get("/api/v3/system/status");

      expect(fetchStub.calls[0].args[0]).toBe("http://localhost:7878/api/v3/system/status");
      expect(fetchStub.calls[0].args[1]).toMatchObject({
        method: "GET",
        headers: {
          "X-Api-Key": "test-api-key",
          "Content-Type": "application/json",
        },
      });
    });
  });

  it("should increment attempt counter in logs", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const warnStub = stub(mockLogger, "warn");
      const fetchStub = stub(
        globalThis,
        "fetch",
        resolvesNext([
          Promise.resolve(createResponse({}, 500)),
          Promise.resolve(createResponse({}, 500)),
          Promise.resolve(createResponse({}, 500)),
          Promise.resolve(createResponse({ status: "ok" })),
        ]),
      );

      const promise = httpClient.get("/api/v3/system/status");
      await time.runAllAsync();
      await promise;

      assertSpyCalls(warnStub, 3);

      const warnCalls = warnStub.calls;
      expect(warnCalls[0].args[0]).toMatchObject({ attempt: 1 });
      expect(warnCalls[1].args[0]).toMatchObject({ attempt: 2 });
      expect(warnCalls[2].args[0]).toMatchObject({ attempt: 3 });
    });
  });

  it("should use interruptible sleep when shutdownEmitter provided", async () => {
    await mockSession(async () => {
      stub(logger, "child", () => mockLogger as never);
      const mockEmitter = new EventEmitter();
      const clientWithShutdown = createHttpClient({
        baseURL: "http://localhost:7878",
        apiKey: "test-api-key",
        maxRetries: 1,
        retryDelay: 1000,
        shutdownEmitter: mockEmitter,
      });

      const fetchStub = stub(
        globalThis,
        "fetch",
        resolvesNext([
          Promise.resolve(createResponse({}, 500)),
          Promise.resolve(createResponse({ status: "ok" })),
        ]),
      );

      const promise = clientWithShutdown.get("/test");
      await time.runAllAsync();

      expect(await promise).toEqual({ status: "ok" });
      assertSpyCalls(fetchStub, 2);
    });
  });
});
