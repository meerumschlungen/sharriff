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

      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('missing', { pageSize: 2 });
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

      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('cutoff', { pageSize: 1 });
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

      // Default upgrade_batch_size is 10 from createSettings
      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('cutoff', { pageSize: 10 });
    });

    it('should handle unlimited batch size (-1)', async () => {
      const mockRecords = [
        { id: 1, title: `${expectedMetadata.mediaSingular} 1` },
        { id: 2, title: `${expectedMetadata.mediaSingular} 2` },
      ];
      vi.spyOn(client as any, 'fetchWantedItems').mockResolvedValue({ records: mockRecords });
      vi.spyOn(client as any, 'triggerSearchesWithStagger').mockResolvedValue(undefined);

      await client.triggerMissingSearches(-1);

      expect((client as any).fetchWantedItems).toHaveBeenCalledWith('missing', undefined);
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
});
