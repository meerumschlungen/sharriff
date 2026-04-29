/**
 * Base class for *arr API clients
 */

import type { GlobalSettings, MediaItem, ArrType } from '../types.js';
import { DEFAULT_SEARCH_ORDER } from '../types.js';
import { type HttpClient, createHttpClient, DEFAULT_TIMEOUT } from '../http/HttpClient.js';
import { createLogger } from '../logger.js';
import type { Logger } from 'pino';
import { interruptibleSleep } from '../utils/shutdown.js';
import type { EventEmitter } from 'events';
import type { Mutex } from '../utils/mutex.js';

interface SystemStatus {
  version: string;
  appName?: string;
}

interface WantedResponse {
  records: MediaItem[];
  page?: number;
  pageSize?: number;
  totalRecords?: number;
}

interface CommandResponse {
  id: number;
  name: string;
  state?: string;
}

/**
 * Client metadata defining type-specific behavior
 */
interface ClientMetadata {
  apiVersion: string;
  commandName: string;
  idField: string;
  mediaSingular: string;
  mediaPlural: string;
  sortTablePrefix: string;
}

/**
 * Registry of client-specific metadata
 * NOTE: sortTablePrefix specifies the entity type returned by wanted/missing:
 * - Radarr/Whisparr: movies (movie entities)
 * - Sonarr: episodes (episode entities, NOT series)
 * - Lidarr: albums (album entities, NOT artists)
 */
const CLIENT_METADATA: Record<ArrType, ClientMetadata> = {
  radarr: {
    apiVersion: 'v3',
    commandName: 'MoviesSearch',
    idField: 'movieIds',
    mediaSingular: 'movie',
    mediaPlural: 'movies',
    sortTablePrefix: 'movies',
  },
  sonarr: {
    apiVersion: 'v3',
    commandName: 'EpisodeSearch',
    idField: 'episodeIds',
    mediaSingular: 'episode',
    mediaPlural: 'episodes',
    sortTablePrefix: 'episodes',
  },
  lidarr: {
    apiVersion: 'v1',
    commandName: 'AlbumSearch',
    idField: 'albumIds',
    mediaSingular: 'album',
    mediaPlural: 'albums',
    sortTablePrefix: 'albums',
  },
  whisparr: {
    apiVersion: 'v3',
    commandName: 'MoviesSearch',
    idField: 'movieIds',
    mediaSingular: 'movie',
    mediaPlural: 'movies',
    sortTablePrefix: 'movies',
  },
};

/**
 * Base sort field names (without table prefix)
 */
const BASE_SORT_FIELDS: Record<string, string> = {
  last_searched: 'lastSearchTime',
  last_added: 'dateAdded',
  release_date: 'releaseDate',
  alphabetical: 'title',
};
/**
 * Format a sample of titles for logging (first maxTitles items)
 */
function formatTitleSample(items: MediaItem[], maxTitles = 5): string {
  const titles = items
    .slice(0, maxTitles)
    .map((item) => item.title ?? `ID:${item.id}`)
    .join(', ');

  if (items.length > maxTitles) {
    return `${titles} ... and ${items.length - maxTitles} more`;
  }
  return titles;
}
export class ArrClient {
  readonly name: string;
  readonly weight: number;
  protected settings: GlobalSettings;
  protected http: HttpClient;
  protected logger: Logger;
  private metadata: ClientMetadata;
  private httpConfig: { baseURL: string; apiKey: string; timeout: number };
  private workMutex?: Mutex;
  private shutdownEmitter?: EventEmitter;

  constructor(
    type: ArrType,
    name: string,
    url: string,
    apiKey: string,
    settings: GlobalSettings,
    weight = 1.0
  ) {
    this.name = name;
    this.settings = settings;
    this.weight = weight;
    this.metadata = CLIENT_METADATA[type];
    this.logger = createLogger({ instance: name });

    this.httpConfig = {
      baseURL: url.replace(/\/$/, ''),
      apiKey,
      timeout: DEFAULT_TIMEOUT,
    };

    this.http = createHttpClient(this.httpConfig);
  }

  /**
   * Initialize and verify connection to the API
   */
  async initialize(): Promise<void> {
    if (this.settings.dry_run) {
      this.logger.info('DRY RUN MODE - Health check');
    }

    const status = await this.http.get<SystemStatus>(
      `/api/${this.metadata.apiVersion}/system/status`
    );
    this.logger.info(
      {
        version: status.version,
        appName: status.appName ?? 'arr',
        apiVersion: this.metadata.apiVersion,
      },
      'Connected to *arr instance'
    );
  }

  /**
   * Get sort parameters for the configured search order
   */
  protected getSortParams() {
    const order =
      this.settings.search_order === 'random' ? DEFAULT_SEARCH_ORDER : this.settings.search_order;
    const lastUnderscore = order.lastIndexOf('_');
    const prefix = order.slice(0, lastUnderscore);

    // Build qualified sort key: "movies.lastSearchTime", "episodes.lastSearchTime", etc.
    const baseField = BASE_SORT_FIELDS[prefix] ?? 'title';
    const sortKey = `${this.metadata.sortTablePrefix}.${baseField}`;

    return {
      sortKey,
      sortDirection: order.slice(lastUnderscore + 1),
    };
  }

  /**
   * Fetch wanted items from API (missing or cutoff unmet)
   */
  async fetchWantedItems(
    type: 'missing' | 'cutoff',
    params?: Record<string, unknown>
  ): Promise<WantedResponse> {
    const endpoint = `/api/${this.metadata.apiVersion}/wanted/${type}`;
    const sortParams = this.getSortParams();
    const fullParams = sortParams ? { ...sortParams, ...params } : params;
    return this.http.get<WantedResponse>(endpoint, fullParams);
  }

  /**
   * Send a command to the *arr instance
   */
  async sendCommand(
    commandName: string,
    params?: Record<string, unknown>,
    cycleId?: string
  ): Promise<CommandResponse> {
    if (this.settings.dry_run) {
      this.logger.info({ command: commandName, params, cycleId }, 'DRY RUN - Would send command');
      return { id: -1, name: commandName, state: 'dry-run' };
    }

    return this.http.post<CommandResponse>(`/api/${this.metadata.apiVersion}/command`, {
      name: commandName,
      ...params,
    });
  }

  /**
   * Set shutdown resources (called after construction)
   */
  setShutdownResources(mutex: Mutex, emitter: EventEmitter): void {
    this.workMutex = mutex;
    this.shutdownEmitter = emitter;

    // Recreate HTTP client with shutdown emitter to make retry backoff interruptible
    this.http = createHttpClient({
      ...this.httpConfig,
      shutdownEmitter: emitter,
    });
  }

  /**
   * Trigger indexer search for a single item (mutex-protected atomic operation)
   */
  protected async triggerItemSearch(item: MediaItem, cycleId?: string): Promise<void> {
    const release = await this.workMutex?.acquire();
    try {
      await this.sendCommand(
        this.metadata.commandName,
        {
          [this.metadata.idField]: [item.id],
        },
        cycleId
      );
    } finally {
      release?.();
    }
  }

  /**
   * Trigger indexer searches with stagger delays between items
   */
  protected async triggerSearchesWithStagger(items: MediaItem[], cycleId?: string): Promise<void> {
    const staggerSeconds = this.settings.stagger_interval_seconds;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      this.logger.debug(
        {
          progress: `${i + 1}/${items.length}`,
          itemId: item.id,
          title: item.title,
          cycleId,
        },
        'Triggering indexer search for item'
      );

      await this.triggerItemSearch(item, cycleId);

      // Interruptible stagger delay
      if (staggerSeconds > 0 && i < items.length - 1 && this.shutdownEmitter) {
        await interruptibleSleep(staggerSeconds * 1000, this.shutdownEmitter);
      }
    }
  }

  /**
   * Check if an item should be included based on retry interval
   *
   * @param item - Media item to check
   * @param retryIntervalDays - Retry interval in days
   * @returns true if item should be included
   */
  private shouldIncludeItem(item: MediaItem, retryIntervalDays: number): boolean {
    if (retryIntervalDays === 0) return true;

    const lastSearchTime = item['lastSearchTime'];

    // Include items never searched (null/undefined/missing)
    if (!lastSearchTime) {
      return true;
    }

    try {
      const lastSearchDate = new Date(lastSearchTime as string).getTime();

      // Invalid date parsing returns NaN
      if (isNaN(lastSearchDate)) {
        this.logger.debug(
          { itemId: item.id, lastSearchTime },
          'Invalid lastSearchTime format, including item'
        );
        return true; // Fail open
      }

      const retryThresholdMs = Date.now() - retryIntervalDays * 24 * 60 * 60 * 1000;

      return lastSearchDate < retryThresholdMs;
    } catch (error) {
      // Date parsing error - fail open
      this.logger.debug(
        { itemId: item.id, lastSearchTime, error },
        'Error parsing lastSearchTime, including item'
      );
      return true;
    }
  }

  /**
   * Fetch wanted items with optional retry interval filtering
   * Uses pagination to avoid memory issues with large lists
   *
   * @param batchType - 'missing' or 'cutoff'
   * @param targetCount - Number of items needed (-1 = unlimited)
   * @param cycleId - Optional cycle ID for logging
   * @returns Array of filtered items
   */
  private async fetchWantedItemsWithFiltering(
    batchType: 'missing' | 'cutoff',
    targetCount: number,
    cycleId?: string
  ): Promise<MediaItem[]> {
    const PAGE_SIZE = 100;
    const retryIntervalDays = this.settings.retry_interval_days;
    const unlimited = targetCount === -1;

    const filteredItems: MediaItem[] = [];
    let currentPage = 1;
    let totalFetched = 0;
    let totalFiltered = 0;

    while (true) {
      // Fetch page
      const response = await this.fetchWantedItems(batchType, {
        page: currentPage,
        pageSize: PAGE_SIZE,
      });

      const pageItems = response.records ?? [];
      totalFetched += pageItems.length;

      this.logger.debug(
        {
          page: currentPage,
          pageSize: pageItems.length,
          totalRecords: response.totalRecords,
          type: batchType,
          cycleId,
        },
        `Fetched page ${currentPage} with ${pageItems.length} items`
      );

      // Filter items if retry interval is enabled
      const itemsToAdd =
        retryIntervalDays > 0
          ? pageItems.filter((item) => this.shouldIncludeItem(item, retryIntervalDays))
          : pageItems;

      filteredItems.push(...itemsToAdd);
      totalFiltered += pageItems.length - itemsToAdd.length;

      // Check termination conditions
      const hasMorePages = response.totalRecords
        ? currentPage * PAGE_SIZE < response.totalRecords
        : pageItems.length === PAGE_SIZE;
      const hasEnoughItems = !unlimited && filteredItems.length >= targetCount;

      if (!hasMorePages || hasEnoughItems) {
        break;
      }

      currentPage++;
    }

    // Trim to exact target count if needed
    const result =
      unlimited || filteredItems.length <= targetCount
        ? filteredItems
        : filteredItems.slice(0, targetCount);

    // Log summary
    if (retryIntervalDays > 0) {
      this.logger.info(
        {
          fetched: totalFetched,
          filtered: totalFiltered,
          retained: result.length,
          pages: currentPage,
          type: batchType,
          retryIntervalDays,
          cycleId,
        },
        `Paged fetch complete: ${result.length} items retained after filtering (${totalFiltered} filtered out)`
      );
    } else {
      this.logger.info(
        {
          fetched: totalFetched,
          retained: result.length,
          pages: currentPage,
          type: batchType,
          cycleId,
        },
        `Paged fetch complete: ${result.length} items fetched`
      );
    }

    // Log info if partial batch (couldn't reach target)
    if (!unlimited && targetCount > 0 && result.length < targetCount && result.length > 0) {
      this.logger.info(
        {
          requested: targetCount,
          found: result.length,
          type: batchType,
          cycleId,
        },
        `Partial batch: Only ${result.length} of ${targetCount} requested items found after filtering`
      );
    }

    return result;
  }

  /**
   * Fetch items and trigger indexer searches (missing or cutoff)
   * Returns the number of searches triggered
   */
  private async processBatch(
    batchType: 'missing' | 'cutoff',
    limit: number,
    cycleId?: string
  ): Promise<number> {
    // -1 = unlimited, 0 = disabled
    if (limit === 0) {
      this.logger.debug({ cycleId }, `${batchType} triggers disabled (batch size = 0)`);
      return 0;
    }

    // Fetch items with pagination and optional retry interval filtering
    const itemsToTrigger = await this.fetchWantedItemsWithFiltering(batchType, limit, cycleId);

    if (itemsToTrigger.length === 0) {
      const message =
        batchType === 'cutoff'
          ? `No cutoff unmet ${this.metadata.mediaPlural} found`
          : `No missing ${this.metadata.mediaPlural} found`;
      this.logger.info({ cycleId }, message);
      return 0;
    }

    const titleSample = formatTitleSample(itemsToTrigger, 5);
    const logMessage =
      batchType === 'cutoff'
        ? `Triggering searches for cutoff unmet: ${titleSample}`
        : `Triggering searches for missing: ${titleSample}`;

    this.logger.info({ count: itemsToTrigger.length, type: batchType, cycleId }, logMessage);

    const triggerStart = Date.now();
    await this.triggerSearchesWithStagger(itemsToTrigger, cycleId);
    const triggerDuration = Date.now() - triggerStart;

    this.logger.info(
      { count: itemsToTrigger.length, type: batchType, durationMs: triggerDuration, cycleId },
      `Triggered ${itemsToTrigger.length} searches`
    );

    return itemsToTrigger.length;
  }

  /**
   * Trigger indexer searches for missing items
   * Returns the number of searches triggered
   */
  async triggerMissingSearches(limit: number, cycleId?: string): Promise<number> {
    return this.processBatch('missing', limit, cycleId);
  }

  /**
   * Trigger indexer searches for cutoff unmet items (items that haven't reached quality cutoff)
   * Returns the number of searches triggered
   */
  async triggerCutoffSearches(limit: number, cycleId?: string): Promise<number> {
    return this.processBatch('cutoff', limit, cycleId);
  }
}
