/**
 * Tests for ArrClient sort parameters and integration methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArrClient } from '../src/clients/ArrClient.js';
import type { GlobalSettings, MediaItem } from '../src/types.js';

// Mock the logger module
vi.mock('../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Create a test settings object
function createSettings(searchOrder: GlobalSettings['search_order']): GlobalSettings {
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

describe('ArrClient metadata configuration', () => {
  describe.each([
    [
      'radarr',
      {
        apiVersion: 'v3',
        commandName: 'MoviesSearch',
        idField: 'movieIds',
        mediaSingular: 'movie',
        mediaPlural: 'movies',
        sortTablePrefix: 'movies',
      },
    ],
    [
      'sonarr',
      {
        apiVersion: 'v3',
        commandName: 'EpisodeSearch',
        idField: 'episodeIds',
        mediaSingular: 'episode',
        mediaPlural: 'episodes',
        sortTablePrefix: 'episodes',
      },
    ],
    [
      'lidarr',
      {
        apiVersion: 'v1',
        commandName: 'AlbumSearch',
        idField: 'albumIds',
        mediaSingular: 'album',
        mediaPlural: 'albums',
        sortTablePrefix: 'albums',
      },
    ],
    [
      'whisparr',
      {
        apiVersion: 'v3',
        commandName: 'MoviesSearch',
        idField: 'movieIds',
        mediaSingular: 'movie',
        mediaPlural: 'movies',
        sortTablePrefix: 'movies',
      },
    ],
  ] as const)('%s client', (type, expectedMetadata) => {
    let client: ArrClient;

    beforeEach(() => {
      const settings = createSettings('last_searched_ascending');
      client = new ArrClient(type, `test-${type}`, 'http://localhost:8080', 'test-key', settings);
    });

    it('should have correct metadata configuration', () => {
      expect((client as any).metadata).toEqual(expectedMetadata);
    });

    it('should use correct API version in paths', () => {
      expect((client as any).metadata.apiVersion).toBe(expectedMetadata.apiVersion);
    });

    it('should have correct command name for searches', () => {
      expect((client as any).metadata.commandName).toBe(expectedMetadata.commandName);
    });

    it('should have correct ID field for batch operations', () => {
      expect((client as any).metadata.idField).toBe(expectedMetadata.idField);
    });

    it('should execute triggerMissingSearches without errors', async () => {
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: [] });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await expect(client.triggerMissingSearches(0)).resolves.toBe(0);
    });

    it('should execute triggerCutoffSearches without errors', async () => {
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: [] });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await expect(client.triggerCutoffSearches(0)).resolves.toBe(0);
    });

    it('should handle missing items with batch limit', async () => {
      const mockRecords = [
        { id: 1, title: `${expectedMetadata.mediaSingular} 1` },
        { id: 2, title: `${expectedMetadata.mediaSingular} 2` },
      ];
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: mockRecords });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerMissingSearches(2);

      // Now uses paged fetching with page=1, pageSize=100
      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('missing', {
        page: 1,
        pageSize: 100,
      });
      expect((client as any).triggerSearchesWithStagger).toHaveBeenCalledWith(
        mockRecords,
        undefined
      );
    });

    it('should handle cutoff items with batch limit', async () => {
      const mockRecords = [{ id: 1, title: `${expectedMetadata.mediaSingular} 1` }];
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: mockRecords });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerCutoffSearches(1);

      // Now uses paged fetching with page=1, pageSize=100
      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('cutoff', {
        page: 1,
        pageSize: 100,
      });
      expect((client as any).triggerSearchesWithStagger).toHaveBeenCalledWith(
        mockRecords,
        undefined
      );
    });

    it('should handle no missing items found', async () => {
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: [] });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerMissingSearches(10);

      expect((client as any).triggerSearchesWithStagger).not.toHaveBeenCalled();
    });

    it('should handle no cutoff items found', async () => {
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: [] });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerCutoffSearches(10);

      expect((client as any).triggerSearchesWithStagger).not.toHaveBeenCalled();
    });

    it('should use default upgrade_batch_size for cutoff when limit not provided', async () => {
      const mockRecords = [{ id: 1, title: `${expectedMetadata.mediaSingular} 1` }];
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: mockRecords });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerCutoffSearches();

      // Now uses paged fetching with page=1, pageSize=100
      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('cutoff', {
        page: 1,
        pageSize: 100,
      });
    });

    it('should handle unlimited batch size (-1)', async () => {
      const mockRecords = [
        { id: 1, title: `${expectedMetadata.mediaSingular} 1` },
        { id: 2, title: `${expectedMetadata.mediaSingular} 2` },
      ];
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: mockRecords });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerMissingSearches(-1);

      // Now uses paged fetching with page=1, pageSize=100
      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('missing', {
        page: 1,
        pageSize: 100,
      });
      expect((client as any).triggerSearchesWithStagger).toHaveBeenCalledWith(
        mockRecords,
        undefined
      );
    });
  });
});

describe('ArrClient getSortParams', () => {
  describe('last_searched ordering', () => {
    it('should return lastSearchTime with ascending direction', () => {
      const settings = createSettings('last_searched_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.lastSearchTime',
        sortDirection: 'ascending',
      });
    });

    it('should return lastSearchTime with descending direction', () => {
      const settings = createSettings('last_searched_descending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.lastSearchTime',
        sortDirection: 'descending',
      });
    });
  });

  describe('last_added ordering', () => {
    it('should return dateAdded with ascending direction', () => {
      const settings = createSettings('last_added_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.dateAdded',
        sortDirection: 'ascending',
      });
    });

    it('should return dateAdded with descending direction', () => {
      const settings = createSettings('last_added_descending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.dateAdded',
        sortDirection: 'descending',
      });
    });
  });

  describe('release_date ordering', () => {
    it('should return releaseDate with ascending direction', () => {
      const settings = createSettings('release_date_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.releaseDate',
        sortDirection: 'ascending',
      });
    });

    it('should return releaseDate with descending direction', () => {
      const settings = createSettings('release_date_descending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.releaseDate',
        sortDirection: 'descending',
      });
    });
  });

  describe('alphabetical ordering', () => {
    it('should return title with ascending direction', () => {
      const settings = createSettings('alphabetical_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.title',
        sortDirection: 'ascending',
      });
    });

    it('should return title with descending direction', () => {
      const settings = createSettings('alphabetical_descending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.title',
        sortDirection: 'descending',
      });
    });
  });

  describe('random ordering', () => {
    it('should fall back to configuration default (last_searched_ascending)', () => {
      const settings = createSettings('random');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.lastSearchTime',
        sortDirection: 'ascending',
      });
    });
  });

  describe('unknown ordering fallback', () => {
    it('should fallback to title when sort key is unknown', () => {
      const settings = createSettings('last_searched_ascending');
      // Override with an unknown sort order
      (settings as any).search_order = 'unknown_prefix_ascending';
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      const params = (client as any).getSortParams();

      expect(params).toEqual({
        sortKey: 'movies.title',
        sortDirection: 'ascending',
      });
    });
  });

  describe('client properties', () => {
    it('should have correct name', () => {
      const settings = createSettings('last_searched_ascending');
      const client = new ArrClient('radarr', 'my-radarr', 'http://test:7878', 'key', settings);

      expect(client.name).toBe('my-radarr');
    });

    it('should have correct weight', () => {
      const settings = createSettings('last_searched_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings, 2.5);

      expect(client.weight).toBe(2.5);
    });

    it('should default weight to 1.0', () => {
      const settings = createSettings('last_searched_ascending');
      const client = new ArrClient('radarr', 'test', 'http://test:7878', 'key', settings);

      expect(client.weight).toBe(1.0);
    });
  });
});

describe('ArrClient integration methods', () => {
  let client: ArrClient;
  let mockHttpGet: any;
  let mockHttpPost: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    const settings: GlobalSettings = {
      interval: 3600,
      missing_batch_size: 20,
      upgrade_batch_size: 10,
      stagger_interval_seconds: 2,
      search_order: 'last_searched_ascending',
      retry_interval_days: 0,
      dry_run: false,
    };

    client = new ArrClient('radarr', 'test-radarr', 'http://localhost:7878', 'test-key', settings);

    // Mock HTTP methods
    mockHttpGet = vi.fn();
    mockHttpPost = vi.fn();
    (client as any).http = {
      get: mockHttpGet,
      post: mockHttpPost,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialize', () => {
    it('should connect and verify API version', async () => {
      mockHttpGet.mockResolvedValue({
        version: '6.1.1.10360',
        appName: 'Radarr',
      });

      await client.initialize();

      expect(mockHttpGet).toHaveBeenCalledWith('/api/v3/system/status');
    });

    it('should handle missing appName in status response', async () => {
      mockHttpGet.mockResolvedValue({
        version: '6.1.1.10360',
      });

      await client.initialize();

      expect(mockHttpGet).toHaveBeenCalledWith('/api/v3/system/status');
    });

    it('should log health check in dry run mode', async () => {
      const dryRunSettings: GlobalSettings = {
        interval: 3600,
        missing_batch_size: 20,
        upgrade_batch_size: 10,
        stagger_interval_seconds: 2,
        search_order: 'last_searched_ascending',
        retry_interval_days: 0,
        dry_run: true,
      };

      const dryRunClient = new ArrClient(
        'radarr',
        'test-radarr',
        'http://localhost:7878',
        'test-key',
        dryRunSettings
      );

      (dryRunClient as any).http = { get: mockHttpGet };

      mockHttpGet.mockResolvedValue({
        version: '6.1.1.10360',
        appName: 'Radarr',
      });

      await dryRunClient.initialize();

      expect(mockHttpGet).toHaveBeenCalledWith('/api/v3/system/status');
    });
  });

  describe('fetchWantedItems', () => {
    it('should get missing items with sort params', async () => {
      const mockResponse = {
        records: [
          { id: 1, title: 'Movie 1' },
          { id: 2, title: 'Movie 2' },
        ],
        page: 1,
        pageSize: 20,
        totalRecords: 2,
      };

      mockHttpGet.mockResolvedValue(mockResponse);

      const result = await (client as any).fetchWantedItems('missing', { page: 1 });

      expect(result).toEqual(mockResponse);
      expect(mockHttpGet).toHaveBeenCalledWith('/api/v3/wanted/missing', {
        sortKey: 'movies.lastSearchTime',
        sortDirection: 'ascending',
        page: 1,
      });
    });

    it('should get cutoff items without extra params', async () => {
      const mockResponse = {
        records: [{ id: 1, title: 'Movie 1' }],
      };

      mockHttpGet.mockResolvedValue(mockResponse);

      const result = await (client as any).fetchWantedItems('cutoff');

      expect(result).toEqual(mockResponse);
      expect(mockHttpGet).toHaveBeenCalledWith('/api/v3/wanted/cutoff', {
        sortKey: 'movies.lastSearchTime',
        sortDirection: 'ascending',
      });
    });
  });

  describe('sendCommand', () => {
    it('should execute command with params', async () => {
      mockHttpPost.mockResolvedValue({
        id: 123,
        name: 'MoviesSearch',
        state: 'queued',
      });

      const result = await (client as any).sendCommand('MoviesSearch', { movieIds: [1, 2, 3] });

      expect(result).toEqual({
        id: 123,
        name: 'MoviesSearch',
        state: 'queued',
      });

      expect(mockHttpPost).toHaveBeenCalledWith('/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [1, 2, 3],
      });
    });

    it('should execute command without params', async () => {
      mockHttpPost.mockResolvedValue({
        id: 124,
        name: 'RefreshMonitoredDownloads',
      });

      await (client as any).sendCommand('RefreshMonitoredDownloads');

      expect(mockHttpPost).toHaveBeenCalledWith('/api/v3/command', {
        name: 'RefreshMonitoredDownloads',
      });
    });

    it('should return dry-run response in dry run mode', async () => {
      const dryRunSettings: GlobalSettings = {
        interval: 3600,
        missing_batch_size: 20,
        upgrade_batch_size: 10,
        stagger_interval_seconds: 2,
        search_order: 'last_searched_ascending',
        retry_interval_days: 0,
        dry_run: true,
      };

      const dryRunClient = new ArrClient(
        'radarr',
        'test',
        'http://localhost:7878',
        'test-key',
        dryRunSettings
      );

      const result = await (dryRunClient as any).sendCommand('MoviesSearch', { movieIds: [1] });

      expect(result).toEqual({
        id: -1,
        name: 'MoviesSearch',
        state: 'dry-run',
      });

      expect(mockHttpPost).not.toHaveBeenCalled();
    });
  });

  describe('triggerSearchesWithStagger', () => {
    it('should search items with stagger delay', async () => {
      const items: MediaItem[] = [
        { id: 1, title: 'Movie 1' },
        { id: 2, title: 'Movie 2' },
        { id: 3, title: 'Movie 3' },
      ];

      mockHttpPost.mockResolvedValue({ id: 100, name: 'MoviesSearch' });

      const promise = (client as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      // Fast-forward through all timers
      await vi.runAllTimersAsync();
      await promise;

      // Should be called once for each item
      expect(mockHttpPost).toHaveBeenCalledTimes(3);

      expect(mockHttpPost).toHaveBeenNthCalledWith(1, '/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [1],
      });

      expect(mockHttpPost).toHaveBeenNthCalledWith(2, '/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [2],
      });

      expect(mockHttpPost).toHaveBeenNthCalledWith(3, '/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [3],
      });
    });

    it('should not stagger after last item', async () => {
      const items: MediaItem[] = [
        { id: 1, title: 'Movie 1' },
        { id: 2, title: 'Movie 2' },
      ];

      mockHttpPost.mockResolvedValue({ id: 100, name: 'MoviesSearch' });

      const startTime = Date.now();
      const promise = (client as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      await vi.runAllTimersAsync();
      await promise;

      // Verify only one stagger delay (2 seconds between item 1 and 2)
      // No delay after item 2
      expect(mockHttpPost).toHaveBeenCalledTimes(2);
    });

    it('should skip stagger when interval is 0', async () => {
      const noStaggerSettings: GlobalSettings = {
        interval: 3600,
        missing_batch_size: 20,
        upgrade_batch_size: 10,
        stagger_interval_seconds: 0,
        search_order: 'last_searched_ascending',
        retry_interval_days: 0,
        dry_run: false,
      };

      const noStaggerClient = new ArrClient(
        'radarr',
        'test',
        'http://localhost:7878',
        'test-key',
        noStaggerSettings
      );

      (noStaggerClient as any).http = { post: mockHttpPost };

      const items: MediaItem[] = [
        { id: 1, title: 'Movie 1' },
        { id: 2, title: 'Movie 2' },
      ];

      mockHttpPost.mockResolvedValue({ id: 100, name: 'MoviesSearch' });

      await (noStaggerClient as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      expect(mockHttpPost).toHaveBeenCalledTimes(2);
    });

    it('should handle empty items array', async () => {
      const items: MediaItem[] = [];

      await (client as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      expect(mockHttpPost).not.toHaveBeenCalled();
    });

    it('should handle single item (no stagger needed)', async () => {
      const items: MediaItem[] = [{ id: 1, title: 'Movie 1' }];

      mockHttpPost.mockResolvedValue({ id: 100, name: 'MoviesSearch' });

      await (client as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      expect(mockHttpPost).toHaveBeenCalledTimes(1);
      expect(mockHttpPost).toHaveBeenCalledWith('/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [1],
      });
    });

    it('should skip undefined/null items in the array', async () => {
      const items: (MediaItem | undefined)[] = [
        { id: 1, title: 'Movie 1' },
        undefined,
        { id: 2, title: 'Movie 2' },
      ];

      mockHttpPost.mockResolvedValue({ id: 100, name: 'MoviesSearch' });

      const promise = (client as any).triggerSearchesWithStagger(items, 'MoviesSearch', 'movieIds');

      await vi.runAllTimersAsync();
      await promise;

      // Should only call for the two valid items, skipping the undefined one
      expect(mockHttpPost).toHaveBeenCalledTimes(2);
      expect(mockHttpPost).toHaveBeenNthCalledWith(1, '/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [1],
      });
      expect(mockHttpPost).toHaveBeenNthCalledWith(2, '/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [2],
      });
    });
  });

  describe('shutdown resources', () => {
    it('should set shutdown resources (mutex and emitter)', async () => {
      const settings = createSettings('last_searched_ascending');
      const client = new ArrClient(
        'radarr',
        'test-radarr',
        'http://radarr:7878',
        'test-key',
        settings,
        1.0
      );

      // Import dependencies for shutdown
      const { Mutex } = await import('../src/utils/mutex.js');
      const { EventEmitter } = await import('events');

      const mockMutex = new Mutex();
      const mockEmitter = new EventEmitter();

      // Call setShutdownResources
      client.setShutdownResources(mockMutex, mockEmitter);

      // Verify internal state (accessing private fields for testing)
      expect((client as any).workMutex).toBe(mockMutex);
      expect((client as any).shutdownEmitter).toBe(mockEmitter);
    });

    it('should use interruptible sleep during stagger when shutdown resources are set', async () => {
      vi.useFakeTimers();

      const settings = createSettings('last_searched_ascending');
      settings.stagger_interval_seconds = 2;

      // Test with Whisparr to ensure coverage for new arr type
      const client = new ArrClient(
        'whisparr',
        'test-whisparr',
        'http://whisparr:6969',
        'test-key',
        settings,
        1.0
      );

      // Import dependencies for shutdown
      const { Mutex } = await import('../src/utils/mutex.js');
      const { EventEmitter } = await import('events');

      const mockMutex = new Mutex();
      const mockEmitter = new EventEmitter();

      // Set shutdown resources so the stagger delay code path is executed
      client.setShutdownResources(mockMutex, mockEmitter);

      // Mock triggerItemSearch to avoid HTTP complexity
      const mockTriggerItemSearch = vi.fn().mockResolvedValue(undefined);
      (client as any).triggerItemSearch = mockTriggerItemSearch;

      const items: MediaItem[] = [
        { id: 1, title: 'Movie 1' },
        { id: 2, title: 'Movie 2' },
        { id: 3, title: 'Movie 3' },
      ];

      // Start the staggered search
      const promise = (client as any).triggerSearchesWithStagger(items);

      // Fast-forward through all timers to execute stagger delays
      await vi.runAllTimersAsync();
      await promise;

      // Should be called once for each item
      expect(mockTriggerItemSearch).toHaveBeenCalledTimes(3);

      // Verify it was called with the correct items
      expect(mockTriggerItemSearch).toHaveBeenNthCalledWith(1, items[0], undefined);
      expect(mockTriggerItemSearch).toHaveBeenNthCalledWith(2, items[1], undefined);
      expect(mockTriggerItemSearch).toHaveBeenNthCalledWith(3, items[2], undefined);

      vi.useRealTimers();
    });
  });

  describe('retry_interval_days filtering', () => {
    // Helper to create timestamps relative to now
    function daysAgo(days: number): string {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString();
    }

    function hoursAgo(hours: number): string {
      const date = new Date();
      date.setHours(date.getHours() - hours);
      return date.toISOString();
    }

    describe('shouldIncludeItem filtering logic', () => {
      it('should include items never searched (no lastSearchTime)', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1' };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include items with undefined lastSearchTime', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: undefined };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include items with null lastSearchTime', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: null };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include items searched before retry interval', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: daysAgo(10) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should exclude items searched within retry interval', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: daysAgo(3) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it('should exclude items searched very recently', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: hoursAgo(1) };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it('should include items at exactly the retry interval boundary', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: daysAgo(7) };
        // At exactly 7 days, should be excluded (still within interval)
        expect((client as any).shouldIncludeItem(item, 7)).toBe(false);
      });

      it('should include items just beyond the retry interval', () => {
        // 7 days + 1 hour should be included
        const date = new Date();
        date.setDate(date.getDate() - 7);
        date.setHours(date.getHours() - 1);
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: date.toISOString() };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include items with invalid lastSearchTime (fail open)', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: 'invalid-date' };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include items with malformed date string', () => {
        const item: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: '2026-99-99' };
        expect((client as any).shouldIncludeItem(item, 7)).toBe(true);
      });

      it('should include all items when retry_interval_days = 0', () => {
        const recentItem: MediaItem = { id: 1, title: 'Movie 1', lastSearchTime: hoursAgo(1) };
        const oldItem: MediaItem = { id: 2, title: 'Movie 2', lastSearchTime: daysAgo(100) };
        const neverSearched: MediaItem = { id: 3, title: 'Movie 3' };

        expect((client as any).shouldIncludeItem(recentItem, 0)).toBe(true);
        expect((client as any).shouldIncludeItem(oldItem, 0)).toBe(true);
        expect((client as any).shouldIncludeItem(neverSearched, 0)).toBe(true);
      });

      it('should handle different retry interval values', () => {
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

    describe('fetchWantedItemsWithFiltering pagination', () => {
      beforeEach(() => {
        mockHttpGet.mockReset();
      });

      it('should fetch single page when enough items found', async () => {
        const items = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: daysAgo(10), // All eligible
        }));

        mockHttpGet.mockResolvedValueOnce({ records: items, pageSize: 100 });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'missing',
          50,
          'test-cycle'
        );

        expect(result).toHaveLength(50);
        expect(mockHttpGet).toHaveBeenCalledTimes(1);
        expect(mockHttpGet).toHaveBeenCalledWith(
          '/api/v3/wanted/missing',
          expect.objectContaining({
            page: 1,
            pageSize: 100,
          })
        );
      });

      it('should fetch multiple pages until batch size reached', async () => {
        // Create client with retry_interval_days > 0 to enable filtering
        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 7;
        const filterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (filterClient as any).http = { get: mockHttpGet };

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

        mockHttpGet
          .mockResolvedValueOnce({ records: page1Items, pageSize: 100 })
          .mockResolvedValueOnce({ records: page2Items, pageSize: 50 });

        const result = await (filterClient as any).fetchWantedItemsWithFiltering(
          'missing',
          20,
          'test-cycle'
        );

        expect(result).toHaveLength(20);
        expect(mockHttpGet).toHaveBeenCalledTimes(2);
        expect(mockHttpGet).toHaveBeenNthCalledWith(
          1,
          '/api/v3/wanted/missing',
          expect.objectContaining({ page: 1 })
        );
        expect(mockHttpGet).toHaveBeenNthCalledWith(
          2,
          '/api/v3/wanted/missing',
          expect.objectContaining({ page: 2 })
        );
      });

      it('should stop early when enough filtered items found', async () => {
        const page1Items = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: daysAgo(10), // All eligible
        }));

        mockHttpGet.mockResolvedValueOnce({ records: page1Items, pageSize: 100 });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'missing',
          50,
          'test-cycle'
        );

        expect(result).toHaveLength(50);
        expect(mockHttpGet).toHaveBeenCalledTimes(1); // Only fetched 1 page, stopped early
      });

      it('should fetch all pages when unlimited batch size (-1)', async () => {
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

        mockHttpGet
          .mockResolvedValueOnce({ records: page1Items, pageSize: 100 })
          .mockResolvedValueOnce({ records: page2Items, pageSize: 30 });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'missing',
          -1,
          'test-cycle'
        );

        expect(result).toHaveLength(130);
        expect(mockHttpGet).toHaveBeenCalledTimes(2);
      });

      it('should return partial batch when not enough items available', async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: daysAgo(10),
        }));

        mockHttpGet.mockResolvedValueOnce({ records: items, pageSize: 10 });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'missing',
          50,
          'test-cycle'
        );

        expect(result).toHaveLength(10); // Only 10 available, not 50
      });

      it('should bypass filtering when retry_interval_days = 0', async () => {
        const items = Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: hoursAgo(1), // Very recent
        }));

        mockHttpGet.mockResolvedValueOnce({ records: items, pageSize: 50 });

        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 0; // Disabled
        const noFilterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (noFilterClient as any).http = { get: mockHttpGet };

        const result = await (noFilterClient as any).fetchWantedItemsWithFiltering(
          'missing',
          50,
          'test-cycle'
        );

        expect(result).toHaveLength(50); // All included despite recent timestamps
      });

      it('should handle empty response', async () => {
        mockHttpGet.mockResolvedValueOnce({ records: [] });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'missing',
          20,
          'test-cycle'
        );

        expect(result).toHaveLength(0);
        expect(mockHttpGet).toHaveBeenCalledTimes(1);
      });

      it('should handle mixed eligible and ineligible items', async () => {
        // Create client with retry_interval_days > 0 to enable filtering
        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 7;
        const filterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (filterClient as any).http = { get: mockHttpGet };

        const items = Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          // Every other item is eligible
          lastSearchTime: i % 2 === 0 ? daysAgo(10) : daysAgo(2),
        }));

        mockHttpGet.mockResolvedValueOnce({ records: items, pageSize: 20 });

        const result = await (filterClient as any).fetchWantedItemsWithFiltering(
          'missing',
          20,
          'test-cycle'
        );

        expect(result).toHaveLength(10); // Half are eligible
      });

      it('should continue fetching when first pages have no eligible items', async () => {
        // Create client with retry_interval_days > 0 to enable filtering
        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 7;
        const filterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (filterClient as any).http = { get: mockHttpGet };

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

        mockHttpGet
          .mockResolvedValueOnce({ records: page1Items, pageSize: 100 })
          .mockResolvedValueOnce({ records: page2Items, pageSize: 100 })
          .mockResolvedValueOnce({ records: page3Items, pageSize: 50 });

        const result = await (filterClient as any).fetchWantedItemsWithFiltering(
          'missing',
          20,
          'test-cycle'
        );

        expect(result).toHaveLength(20);
        expect(mockHttpGet).toHaveBeenCalledTimes(3);
      });

      it('should work with cutoff batch type', async () => {
        const items = Array.from({ length: 30 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: daysAgo(10),
        }));

        mockHttpGet.mockResolvedValueOnce({ records: items, pageSize: 30 });

        const result = await (client as any).fetchWantedItemsWithFiltering(
          'cutoff',
          20,
          'test-cycle'
        );

        expect(result).toHaveLength(20);
        expect(mockHttpGet).toHaveBeenCalledWith(
          '/api/v3/wanted/cutoff',
          expect.objectContaining({
            page: 1,
            pageSize: 100,
          })
        );
      });
    });

    describe('processBatch integration with filtering', () => {
      beforeEach(() => {
        mockHttpGet.mockReset();
        mockHttpPost.mockReset();
      });

      it('should use paged fetching with filtering when retry_interval_days > 0', async () => {
        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 7;
        const filterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (filterClient as any).http = { get: mockHttpGet, post: mockHttpPost };

        const items = Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
          lastSearchTime: daysAgo(10),
        }));

        mockHttpGet.mockResolvedValue({ records: items, pageSize: 20 });
        mockHttpPost.mockResolvedValue({ id: 123, name: 'MoviesSearch' });

        await filterClient.triggerMissingSearches(20, 'test-cycle');

        expect(mockHttpGet).toHaveBeenCalledWith(
          '/api/v3/wanted/missing',
          expect.objectContaining({
            page: 1,
            pageSize: 100,
          })
        );
      });

      it('should use paged fetching even when retry_interval_days = 0', async () => {
        const settings = createSettings('last_searched_ascending');
        settings.retry_interval_days = 0;
        const noFilterClient = new ArrClient('radarr', 'test', 'http://localhost', 'key', settings);
        (noFilterClient as any).http = { get: mockHttpGet, post: mockHttpPost };

        const items = Array.from({ length: 20 }, (_, i) => ({
          id: i + 1,
          title: `Movie ${i + 1}`,
        }));

        mockHttpGet.mockResolvedValue({ records: items, pageSize: 20 });
        mockHttpPost.mockResolvedValue({ id: 123, name: 'MoviesSearch' });

        await noFilterClient.triggerMissingSearches(20, 'test-cycle');

        // Should still use pagination API
        expect(mockHttpGet).toHaveBeenCalledWith(
          '/api/v3/wanted/missing',
          expect.objectContaining({
            page: 1,
            pageSize: 100,
          })
        );
      });
    });
  });
});
