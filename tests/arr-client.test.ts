/**
 * Tests for ArrClient sort parameters and integration methods
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "@std/expect";
import { assertSpyCalls, mockSession, resolvesNext, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { ArrClient } from "../src/clients/ArrClient.ts";
import type { GlobalSettings, MediaItem } from "../src/types.ts";
import { Mutex } from "../src/utils/mutex.ts";
import { logger } from "../src/logger.ts";

// Mock logger to capture log calls (stub logger.child to intercept createLogger)
const mockLogger = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

// Create a test settings object
function createSettings(searchOrder: GlobalSettings["search_order"]): GlobalSettings {
  return {
    interval: 3600,
    missing_batch_size: 20,
    upgrade_batch_size: 10,
    stagger_interval_seconds: 30,
    search_order: searchOrder,
    retry_interval_days: 0,
    dry_run: true,
  };
}

// Client metadata table (replaces describe.each)
const CLIENT_TYPES = [
  {
    type: "radarr",
    metadata: {
      apiVersion: "v3",
      commandName: "MoviesSearch",
      idField: "movieIds",
      mediaSingular: "movie",
      mediaPlural: "movies",
      sortTablePrefix: "movies",
    },
  },
  {
    type: "sonarr",
    metadata: {
      apiVersion: "v3",
      commandName: "EpisodeSearch",
      idField: "episodeIds",
      mediaSingular: "episode",
      mediaPlural: "episodes",
      sortTablePrefix: "episodes",
    },
  },
  {
    type: "lidarr",
    metadata: {
      apiVersion: "v1",
      commandName: "AlbumSearch",
      idField: "albumIds",
      mediaSingular: "album",
      mediaPlural: "albums",
      sortTablePrefix: "albums",
    },
  },
  {
    type: "whisparr",
    metadata: {
      apiVersion: "v3",
      commandName: "MoviesSearch",
      idField: "movieIds",
      mediaSingular: "movie",
      mediaPlural: "movies",
      sortTablePrefix: "movies",
    },
  },
] as const;

describe("ArrClient metadata configuration", { concurrency: false }, () => {
  for (const { type, metadata } of CLIENT_TYPES) {
    describe(`${type} client`, () => {
      let client: ArrClient;

      beforeEach(() => {
        const settings = createSettings("last_searched_ascending");
        client = new ArrClient(type, `test-${type}`, "http://localhost:8080", "test-key", settings);
      });

      it("should have correct metadata configuration", () => {
        expect((client as any).metadata).toEqual(metadata);
      });

      it("should use correct API version in paths", () => {
        expect((client as any).metadata.apiVersion).toBe(metadata.apiVersion);
      });

      it("should have correct command name for searches", () => {
        expect((client as any).metadata.commandName).toBe(metadata.commandName);
      });

      it("should have correct ID field for batch operations", () => {
        expect((client as any).metadata.idField).toBe(metadata.idField);
      });

      it("should execute triggerMissingSearches without errors", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          stub(client as any, "fetchWantedItems", async () => ({ records: [] }));
          stub(client as any, "triggerSearchesWithStagger", async () => undefined);

          await expect(client.triggerMissingSearches(0)).resolves.toBe(0);
        });
      });

      it("should execute triggerCutoffSearches without errors", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          stub(client as any, "fetchWantedItems", async () => ({ records: [] }));
          stub(client as any, "triggerSearchesWithStagger", async () => undefined);

          await expect(client.triggerCutoffSearches(0)).resolves.toBe(0);
        });
      });

      it("should handle missing items with batch limit", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const mockRecords = [
            { id: 1, title: `${metadata.mediaSingular} 1` },
            { id: 2, title: `${metadata.mediaSingular} 2` },
          ];
          const fetchStub = stub(client as any, "fetchWantedItems", async () => ({
            records: mockRecords,
          }));
          const staggerStub = stub(client as any, "triggerSearchesWithStagger", async () =>
            undefined
          );

          await client.triggerMissingSearches(2);

          // Now uses paged fetching with page=1, pageSize=100
          expect(fetchStub.calls[0].args).toEqual(["missing", { page: 1, pageSize: 100 }]);
          expect(staggerStub.calls[0].args).toEqual([mockRecords, undefined]);
        });
      });

      it("should handle cutoff items with batch limit", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const mockRecords = [{ id: 1, title: `${metadata.mediaSingular} 1` }];
          const fetchStub = stub(client as any, "fetchWantedItems", async () => ({
            records: mockRecords,
          }));
          const staggerStub = stub(client as any, "triggerSearchesWithStagger", async () =>
            undefined
          );

          await client.triggerCutoffSearches(1);

          // Now uses paged fetching with page=1, pageSize=100
          expect(fetchStub.calls[0].args).toEqual(["cutoff", { page: 1, pageSize: 100 }]);
          expect(staggerStub.calls[0].args).toEqual([mockRecords, undefined]);
        });
      });

      it("should handle no missing items found", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          stub(client as any, "fetchWantedItems", async () => ({ records: [] }));
          const staggerStub = stub(client as any, "triggerSearchesWithStagger", async () =>
            undefined
          );

          await client.triggerMissingSearches(10);

          assertSpyCalls(staggerStub, 0);
        });
      });

      it("should handle no cutoff items found", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          stub(client as any, "fetchWantedItems", async () => ({ records: [] }));
          const staggerStub = stub(client as any, "triggerSearchesWithStagger", async () =>
            undefined
          );

          await client.triggerCutoffSearches(10);

          assertSpyCalls(staggerStub, 0);
        });
      });

      it("should handle unlimited batch size (-1)", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const mockRecords = [
            { id: 1, title: `${metadata.mediaSingular} 1` },
            { id: 2, title: `${metadata.mediaSingular} 2` },
          ];
          const fetchStub = stub(client as any, "fetchWantedItems", async () => ({
            records: mockRecords,
          }));
          const staggerStub = stub(client as any, "triggerSearchesWithStagger", async () =>
            undefined
          );

          await client.triggerMissingSearches(-1);

          // Now uses paged fetching with page=1, pageSize=100
          expect(fetchStub.calls[0].args).toEqual(["missing", { page: 1, pageSize: 100 }]);
          expect(staggerStub.calls[0].args).toEqual([mockRecords, undefined]);
        });
      });
    });
  }
});

describe("ArrClient getSortParams", { concurrency: false }, () => {
  describe("last_searched ordering", () => {
    it("should return lastSearchTime with ascending direction", () => {
      const settings = createSettings("last_searched_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.lastSearchTime",
        sortDirection: "ascending",
      });
    });

    it("should return lastSearchTime with descending direction", () => {
      const settings = createSettings("last_searched_descending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.lastSearchTime",
        sortDirection: "descending",
      });
    });
  });

  describe("last_added ordering", () => {
    it("should return dateAdded with ascending direction", () => {
      const settings = createSettings("last_added_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.dateAdded",
        sortDirection: "ascending",
      });
    });

    it("should return dateAdded with descending direction", () => {
      const settings = createSettings("last_added_descending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.dateAdded",
        sortDirection: "descending",
      });
    });
  });

  describe("release_date ordering", () => {
    it("should return releaseDate with ascending direction", () => {
      const settings = createSettings("release_date_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.releaseDate",
        sortDirection: "ascending",
      });
    });

    it("should return releaseDate with descending direction", () => {
      const settings = createSettings("release_date_descending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.releaseDate",
        sortDirection: "descending",
      });
    });
  });

  describe("alphabetical ordering", () => {
    it("should return title with ascending direction", () => {
      const settings = createSettings("alphabetical_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.title",
        sortDirection: "ascending",
      });
    });

    it("should return title with descending direction", () => {
      const settings = createSettings("alphabetical_descending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.title",
        sortDirection: "descending",
      });
    });
  });

  describe("random ordering", () => {
    it("should fall back to configuration default (last_searched_ascending)", () => {
      const settings = createSettings("random");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.lastSearchTime",
        sortDirection: "ascending",
      });
    });
  });

  describe("unknown ordering fallback", () => {
    it("should fallback to title when sort key is unknown", () => {
      const settings = createSettings("last_searched_ascending");
      // Override with an unknown sort order
      (settings as any).search_order = "unknown_prefix_ascending";
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: "movies.title",
        sortDirection: "ascending",
      });
    });
  });

  describe("client properties", () => {
    it("should have correct name", () => {
      const settings = createSettings("last_searched_ascending");
      const client = new ArrClient("radarr", "my-radarr", "http://test:7878", "key", settings);

      expect(client.name).toBe("my-radarr");
    });

    it("should have correct weight", () => {
      const settings = createSettings("last_searched_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings, 2.5);

      expect(client.weight).toBe(2.5);
    });

    it("should default weight to 1.0", () => {
      const settings = createSettings("last_searched_ascending");
      const client = new ArrClient("radarr", "test", "http://test:7878", "key", settings);

      expect(client.weight).toBe(1.0);
    });
  });
});

describe("ArrClient integration methods", { concurrency: false }, () => {
  let client: ArrClient;
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();

    const settings: GlobalSettings = {
      interval: 3600,
      missing_batch_size: 20,
      upgrade_batch_size: 10,
      stagger_interval_seconds: 2,
      search_order: "last_searched_ascending",
      retry_interval_days: 0,
      dry_run: false,
    };

    client = new ArrClient("radarr", "test-radarr", "http://localhost:7878", "test-key", settings);
  });

  afterEach(() => {
    time.restore();
  });

  describe("initialize", () => {
    it("should connect and verify API version", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const http = { get: (_url: string) => Promise.resolve({}) };
        const getStub = stub(http, "get", async () => ({
          version: "6.1.1.10360",
          appName: "Radarr",
        }));
        (client as any).http = http;

        await client.initialize();

        expect(getStub.calls[0].args[0]).toBe("/api/v3/system/status");
      });
    });

    it("should handle missing appName in status response", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const http = { get: (_url: string) => Promise.resolve({}) };
        const getStub = stub(http, "get", async () => ({
          version: "6.1.1.10360",
        }));
        (client as any).http = http;

        await client.initialize();

        expect(getStub.calls[0].args[0]).toBe("/api/v3/system/status");
      });
    });

    it("should log health check in dry run mode", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const dryRunSettings: GlobalSettings = {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 2,
          search_order: "last_searched_ascending",
          retry_interval_days: 0,
          dry_run: true,
        };

        const dryRunClient = new ArrClient(
          "radarr",
          "test-radarr",
          "http://localhost:7878",
          "test-key",
          dryRunSettings,
        );

        const http = { get: (_url: string) => Promise.resolve({}) };
        const getStub = stub(http, "get", async () => ({
          version: "6.1.1.10360",
          appName: "Radarr",
        }));
        (dryRunClient as any).http = http;

        await dryRunClient.initialize();

        expect(getStub.calls[0].args[0]).toBe("/api/v3/system/status");
      });
    });
  });

  describe("fetchWantedItems", () => {
    it("should get missing items with sort params", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const mockResponse = {
          records: [
            { id: 1, title: "Movie 1" },
            { id: 2, title: "Movie 2" },
          ],
          page: 1,
          pageSize: 20,
          totalRecords: 2,
        };

        const http = { get: (_url: string) => Promise.resolve({}) };
        const getStub = stub(http, "get", async () => mockResponse);
        (client as any).http = http;

        const result = await (client as any).fetchWantedItems("missing", { page: 1 });

        expect(result).toEqual(mockResponse);
        expect(getStub.calls[0].args).toEqual([
          "/api/v3/wanted/missing",
          {
            sortKey: "movies.lastSearchTime",
            sortDirection: "ascending",
            page: 1,
          },
        ]);
      });
    });

    it("should get cutoff items without extra params", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const mockResponse = {
          records: [{ id: 1, title: "Movie 1" }],
        };

        const http = { get: (_url: string) => Promise.resolve({}) };
        const getStub = stub(http, "get", async () => mockResponse);
        (client as any).http = http;

        const result = await (client as any).fetchWantedItems("cutoff");

        expect(result).toEqual(mockResponse);
        expect(getStub.calls[0].args).toEqual([
          "/api/v3/wanted/cutoff",
          {
            sortKey: "movies.lastSearchTime",
            sortDirection: "ascending",
          },
        ]);
      });
    });
  });

  describe("sendCommand", () => {
    it("should execute command with params", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({
          id: 123,
          name: "MoviesSearch",
          state: "queued",
        }));
        (client as any).http = http;

        const result = await (client as any).sendCommand("MoviesSearch", { movieIds: [1, 2, 3] });

        expect(result).toEqual({
          id: 123,
          name: "MoviesSearch",
          state: "queued",
        });

        expect(postStub.calls[0].args).toEqual([
          "/api/v3/command",
          {
            name: "MoviesSearch",
            movieIds: [1, 2, 3],
          },
        ]);
      });
    });

    it("should execute command without params", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({
          id: 124,
          name: "RefreshMonitoredDownloads",
        }));
        (client as any).http = http;

        await (client as any).sendCommand("RefreshMonitoredDownloads");

        expect(postStub.calls[0].args).toEqual([
          "/api/v3/command",
          {
            name: "RefreshMonitoredDownloads",
          },
        ]);
      });
    });

    it("should return dry-run response in dry run mode", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const dryRunSettings: GlobalSettings = {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 2,
          search_order: "last_searched_ascending",
          retry_interval_days: 0,
          dry_run: true,
        };

        const dryRunClient = new ArrClient(
          "radarr",
          "test",
          "http://localhost:7878",
          "test-key",
          dryRunSettings,
        );

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({}));
        (dryRunClient as any).http = http;

        const result = await (dryRunClient as any).sendCommand("MoviesSearch", { movieIds: [1] });

        expect(result).toEqual({
          id: -1,
          name: "MoviesSearch",
          state: "dry-run",
        });

        assertSpyCalls(postStub, 0);
      });
    });
  });

  describe("triggerSearchesWithStagger", () => {
    it("should search items with stagger delay", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const items: MediaItem[] = [
          { id: 1, title: "Movie 1" },
          { id: 2, title: "Movie 2" },
          { id: 3, title: "Movie 3" },
        ];

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({ id: 100, name: "MoviesSearch" }));
        (client as any).http = http;

        const promise = (client as any).triggerSearchesWithStagger(
          items,
          "MoviesSearch",
          "movieIds",
        );

        // Fast-forward through all timers
        await time.runAllAsync();
        await promise;

        // Should be called once for each item
        assertSpyCalls(postStub, 3);

        expect(postStub.calls[0].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [1] },
        ]);
        expect(postStub.calls[1].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [2] },
        ]);
        expect(postStub.calls[2].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [3] },
        ]);
      });
    });

    it("should not stagger after last item", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const items: MediaItem[] = [
          { id: 1, title: "Movie 1" },
          { id: 2, title: "Movie 2" },
        ];

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({ id: 100, name: "MoviesSearch" }));
        (client as any).http = http;

        const promise = (client as any).triggerSearchesWithStagger(
          items,
          "MoviesSearch",
          "movieIds",
        );

        await time.runAllAsync();
        await promise;

        // Verify only one stagger delay (2 seconds between item 1 and 2)
        // No delay after item 2
        assertSpyCalls(postStub, 2);
      });
    });

    it("should skip stagger when interval is 0", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const noStaggerSettings: GlobalSettings = {
          interval: 3600,
          missing_batch_size: 20,
          upgrade_batch_size: 10,
          stagger_interval_seconds: 0,
          search_order: "last_searched_ascending",
          retry_interval_days: 0,
          dry_run: false,
        };

        const noStaggerClient = new ArrClient(
          "radarr",
          "test",
          "http://localhost:7878",
          "test-key",
          noStaggerSettings,
        );

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({ id: 100, name: "MoviesSearch" }));
        (noStaggerClient as any).http = http;

        const items: MediaItem[] = [
          { id: 1, title: "Movie 1" },
          { id: 2, title: "Movie 2" },
        ];

        await (noStaggerClient as any).triggerSearchesWithStagger(
          items,
          "MoviesSearch",
          "movieIds",
        );

        assertSpyCalls(postStub, 2);
      });
    });

    it("should handle empty items array", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({}));
        (client as any).http = http;

        const items: MediaItem[] = [];

        await (client as any).triggerSearchesWithStagger(items, "MoviesSearch", "movieIds");

        assertSpyCalls(postStub, 0);
      });
    });

    it("should handle single item (no stagger needed)", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const items: MediaItem[] = [{ id: 1, title: "Movie 1" }];

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({ id: 100, name: "MoviesSearch" }));
        (client as any).http = http;

        await (client as any).triggerSearchesWithStagger(items, "MoviesSearch", "movieIds");

        assertSpyCalls(postStub, 1);
        expect(postStub.calls[0].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [1] },
        ]);
      });
    });

    it("should skip undefined/null items in the array", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const items: (MediaItem | undefined)[] = [
          { id: 1, title: "Movie 1" },
          undefined,
          { id: 2, title: "Movie 2" },
        ];

        const http = { post: (_url: string) => Promise.resolve({}) };
        const postStub = stub(http, "post", async () => ({ id: 100, name: "MoviesSearch" }));
        (client as any).http = http;

        const promise = (client as any).triggerSearchesWithStagger(
          items,
          "MoviesSearch",
          "movieIds",
        );

        await time.runAllAsync();
        await promise;

        // Should only call for the two valid items, skipping the undefined one
        assertSpyCalls(postStub, 2);
        expect(postStub.calls[0].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [1] },
        ]);
        expect(postStub.calls[1].args).toEqual([
          "/api/v3/command",
          { name: "MoviesSearch", movieIds: [2] },
        ]);
      });
    });
  });

  describe("shutdown resources", () => {
    it("should set shutdown resources (mutex and emitter)", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const settings = createSettings("last_searched_ascending");
        const client = new ArrClient(
          "radarr",
          "test-radarr",
          "http://radarr:7878",
          "test-key",
          settings,
          1.0,
        );

        const mockMutex = new Mutex();
        const mockEmitter = new EventEmitter();

        // Call setShutdownResources
        client.setShutdownResources(mockMutex, mockEmitter);

        // Verify internal state (accessing private fields for testing)
        expect((client as any).workMutex).toBe(mockMutex);
        expect((client as any).shutdownEmitter).toBe(mockEmitter);
      });
    });

    it("should use interruptible sleep during stagger when shutdown resources are set", async () => {
      await mockSession(async () => {
        stub(logger, "child", () => mockLogger as never);
        const settings = createSettings("last_searched_ascending");
        settings.stagger_interval_seconds = 2;

        // Test with Whisparr to ensure coverage for new arr type
        const client = new ArrClient(
          "whisparr",
          "test-whisparr",
          "http://whisparr:6969",
          "test-key",
          settings,
          1.0,
        );

        const mockMutex = new Mutex();
        const mockEmitter = new EventEmitter();

        // Set shutdown resources so the stagger delay code path is executed
        client.setShutdownResources(mockMutex, mockEmitter);

        // Mock triggerItemSearch to avoid HTTP complexity
        const triggerStub = stub(client as any, "triggerItemSearch", async () => undefined);

        const items: MediaItem[] = [
          { id: 1, title: "Movie 1" },
          { id: 2, title: "Movie 2" },
          { id: 3, title: "Movie 3" },
        ];

        // Start the staggered search
        const promise = (client as any).triggerSearchesWithStagger(items);

        // Fast-forward through all timers to execute stagger delays
        await time.runAllAsync();
        await promise;

        // Should be called once for each item
        assertSpyCalls(triggerStub, 3);

        // Verify it was called with the correct items
        expect(triggerStub.calls[0].args).toEqual([items[0], undefined]);
        expect(triggerStub.calls[1].args).toEqual([items[1], undefined]);
        expect(triggerStub.calls[2].args).toEqual([items[2], undefined]);
      });
    });
  });

  describe("retry_interval_days filtering", () => {
    const FIXED_NOW = new Date("2024-01-15T12:00:00.000Z");

    // Helper to create timestamps relative to now using fixed millisecond offsets
    function daysAgo(days: number): string {
      return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    function hoursAgo(hours: number): string {
      return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    }

    describe("shouldIncludeItem filtering logic", () => {
      it("should include items never searched (no lastSearchTime)", () => {
        const item: MediaItem = { id: 1, title: "Movie 1" };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include items with undefined lastSearchTime", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: undefined };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include items with null lastSearchTime", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: null };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include items searched before retry interval", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: daysAgo(10) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should exclude items searched within retry interval", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: daysAgo(3) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it("should exclude items searched very recently", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: hoursAgo(1) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it("should exclude items at exactly the retry interval boundary", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: daysAgo(7) };
        // At exactly 7 days, should be excluded (still within interval)
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it("should include items just beyond the retry interval", () => {
        // 7 days + 1 hour should be included
        const date = new Date();
        date.setDate(date.getDate() - 7);
        date.setHours(date.getHours() - 1);
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: date.toISOString() };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include items with invalid lastSearchTime (fail open)", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: "invalid-date" };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include items with malformed date string", () => {
        const item: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: "2026-99-99" };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it("should include all items when retry_interval_days = 0", () => {
        const recentItem: MediaItem = { id: 1, title: "Movie 1", lastSearchTime: hoursAgo(1) };
        const oldItem: MediaItem = { id: 2, title: "Movie 2", lastSearchTime: daysAgo(100) };
        const neverSearched: MediaItem = { id: 3, title: "Movie 3" };

        expect((client as any).shouldIncludeItem(recentItem, 0)).toBe(true);
        expect((client as any).shouldIncludeItem(oldItem, 0)).toBe(true);
        expect((client as any).shouldIncludeItem(neverSearched, 0)).toBe(true);
      });

      it("should handle different retry interval values", () => {
        const item30Days: MediaItem = { id: 1, lastSearchTime: daysAgo(35) };
        const item7Days: MediaItem = { id: 2, lastSearchTime: daysAgo(10) };
        const item1Day: MediaItem = { id: 3, lastSearchTime: hoursAgo(12) };

        // 30 days interval
        expect((client as any).shouldIncludeItem(item30Days, 30)).toBe(true);
        expect((client as any).shouldIncludeItem(item7Days, 30)).toBe(false);

        // 7 days interval
        expect((client as any).shouldIncludeItem(item7Days, 7)).toBe(true);
        expect((client as any).shouldIncludeItem(item1Day, 7)).toBe(false);

        // 1 day interval
        expect((client as any).shouldIncludeItem(item1Day, 1)).toBe(false);
        expect((client as any).shouldIncludeItem(item7Days, 1)).toBe(true);
      });
    });

    describe("fetchWantedItemsWithFiltering pagination", () => {
      it("should fetch single page when enough items found", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10), // All eligible
          }));

          const http = { get: (_url: string, _params?: unknown) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 100 }));
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "missing",
            50,
            "test-cycle",
          );

          expect(result).toHaveLength(50);
          assertSpyCalls(getStub, 1);
          expect(getStub.calls[0].args[1]).toMatchObject({
            page: 1,
            pageSize: 100,
          });
        });
      });

      it("should fetch multiple pages until batch size reached", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          // Create client with retry_interval_days > 0 to enable filtering
          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 7;
          const filterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          // Page 1: 100 items, all recent (filtered out)
          const page1Items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(2), // Too recent
          }));

          // Page 2: 50 items, first 20 eligible
          const page2Items = Array.from({ length: 50 }, (_, i) => ({
            id: i + 101,
            title: `Movie ${i + 101}`,
            lastSearchTime: i < 20 ? daysAgo(10) : daysAgo(2),
          }));

          const http = { get: (_url: string, _params?: unknown) => Promise.resolve({}) };
          const getStub = stub(
            http,
            "get",
            resolvesNext([
              Promise.resolve({ records: page1Items, pageSize: 100 }),
              Promise.resolve({ records: page2Items, pageSize: 50 }),
            ]),
          );
          (filterClient as any).http = http;

          const result = await (filterClient as any).fetchWantedItemsWithFiltering(
            "missing",
            20,
            "test-cycle",
          );

          expect(result).toHaveLength(20);
          assertSpyCalls(getStub, 2);
          expect(getStub.calls[0].args[1]).toMatchObject({ page: 1 });
          expect(getStub.calls[1].args[1]).toMatchObject({ page: 2 });
        });
      });

      it("should stop early when enough filtered items found", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const page1Items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10), // All eligible
          }));

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: page1Items, pageSize: 100 }));
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "missing",
            50,
            "test-cycle",
          );

          expect(result).toHaveLength(50);
          assertSpyCalls(getStub, 1); // Only fetched 1 page, stopped early
        });
      });

      it("should fetch all pages when unlimited batch size (-1)", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const page1Items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10),
          }));

          const page2Items = Array.from({ length: 30 }, (_, i) => ({
            id: i + 101,
            title: `Movie ${i + 101}`,
            lastSearchTime: daysAgo(10),
          }));

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(
            http,
            "get",
            resolvesNext([
              Promise.resolve({ records: page1Items, pageSize: 100 }),
              Promise.resolve({ records: page2Items, pageSize: 30 }),
            ]),
          );
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "missing",
            -1,
            "test-cycle",
          );

          expect(result).toHaveLength(130);
          assertSpyCalls(getStub, 2);
        });
      });

      it("should return partial batch when not enough items available", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const items = Array.from({ length: 10 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10),
          }));

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 10 }));
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "missing",
            50,
            "test-cycle",
          );

          expect(result).toHaveLength(10); // Only 10 available, not 50
        });
      });

      it("should bypass filtering when retry_interval_days = 0", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const items = Array.from({ length: 50 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: hoursAgo(1), // Very recent
          }));

          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 0; // Disabled
          const noFilterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 50 }));
          (noFilterClient as any).http = http;

          const result = await (noFilterClient as any).fetchWantedItemsWithFiltering(
            "missing",
            50,
            "test-cycle",
          );

          expect(result).toHaveLength(50); // All included despite recent timestamps
        });
      });

      it("should handle empty response", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: [] }));
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "missing",
            20,
            "test-cycle",
          );

          expect(result).toHaveLength(0);
          assertSpyCalls(getStub, 1);
        });
      });

      it("should handle mixed eligible and ineligible items", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          // Create client with retry_interval_days > 0 to enable filtering
          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 7;
          const filterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          const items = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            // Every other item is eligible
            lastSearchTime: i % 2 === 0 ? daysAgo(10) : daysAgo(2),
          }));

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 20 }));
          (filterClient as any).http = http;

          const result = await (filterClient as any).fetchWantedItemsWithFiltering(
            "missing",
            20,
            "test-cycle",
          );

          expect(result).toHaveLength(10); // Half are eligible
        });
      });

      it("should continue fetching when first pages have no eligible items", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          // Create client with retry_interval_days > 0 to enable filtering
          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 7;
          const filterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          const page1Items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            lastSearchTime: hoursAgo(1), // All recent
          }));

          const page2Items = Array.from({ length: 100 }, (_, i) => ({
            id: i + 101,
            lastSearchTime: hoursAgo(1), // All recent
          }));

          const page3Items = Array.from({ length: 50 }, (_, i) => ({
            id: i + 201,
            lastSearchTime: daysAgo(10), // All eligible
          }));

          const http = { get: (_url: string) => Promise.resolve({}) };
          const getStub = stub(
            http,
            "get",
            resolvesNext([
              Promise.resolve({ records: page1Items, pageSize: 100 }),
              Promise.resolve({ records: page2Items, pageSize: 100 }),
              Promise.resolve({ records: page3Items, pageSize: 50 }),
            ]),
          );
          (filterClient as any).http = http;

          const result = await (filterClient as any).fetchWantedItemsWithFiltering(
            "missing",
            20,
            "test-cycle",
          );

          expect(result).toHaveLength(20);
          assertSpyCalls(getStub, 3);
        });
      });

      it("should work with cutoff batch type", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const items = Array.from({ length: 30 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10),
          }));

          const http = { get: (_url: string, _params?: unknown) => Promise.resolve({}) };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 30 }));
          (client as any).http = http;

          const result = await (client as any).fetchWantedItemsWithFiltering(
            "cutoff",
            20,
            "test-cycle",
          );

          expect(result).toHaveLength(20);
          expect(getStub.calls[0].args[1]).toMatchObject({
            page: 1,
            pageSize: 100,
          });
        });
      });
    });

    describe("processBatch integration with filtering", () => {
      it("should use paged fetching with filtering when retry_interval_days > 0", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 7;
          const filterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          const items = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
            lastSearchTime: daysAgo(10),
          }));

          const http = {
            get: (_url: string, _params?: unknown) => Promise.resolve({}),
            post: (_url: string) => Promise.resolve({}),
          };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 20 }));
          const postStub = stub(http, "post", async () => ({ id: 123, name: "MoviesSearch" }));
          (filterClient as any).http = http;

          await filterClient.triggerMissingSearches(20, "test-cycle");

          expect(getStub.calls[0].args[1]).toMatchObject({
            page: 1,
            pageSize: 100,
          });
        });
      });

      it("should use paged fetching even when retry_interval_days = 0", async () => {
        await mockSession(async () => {
          stub(logger, "child", () => mockLogger as never);
          const settings = createSettings("last_searched_ascending");
          settings.retry_interval_days = 0;
          const noFilterClient = new ArrClient("radarr", "test", "http://localhost", "key", settings);

          const items = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            title: `Movie ${i + 1}`,
          }));

          const http = {
            get: (_url: string, _params?: unknown) => Promise.resolve({}),
            post: (_url: string) => Promise.resolve({}),
          };
          const getStub = stub(http, "get", async () => ({ records: items, pageSize: 20 }));
          const postStub = stub(http, "post", async () => ({ id: 123, name: "MoviesSearch" }));
          (noFilterClient as any).http = http;

          await noFilterClient.triggerMissingSearches(20, "test-cycle");

          // Should still use pagination API
          expect(getStub.calls[0].args[1]).toMatchObject({
            page: 1,
            pageSize: 100,
          });
        });
      });
    });
  });
});
