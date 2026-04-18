/**
 * Base class for *arr API clients
 */

import type { GlobalSettings, MediaItem, ArrType } from '../types.js';
import { DEFAULT_SEARCH_ORDER } from '../types.js';
import { type HttpClient, createHttpClient } from '../http/HttpClient.js';
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
      timeout: 30000,
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
    params?: Record<string, unknown>
  ): Promise<CommandResponse> {
    if (this.settings.dry_run) {
      this.logger.info({ command: commandName, params }, 'DRY RUN - Would send command');
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
  protected async triggerItemSearch(item: MediaItem): Promise<void> {
    const release = await this.workMutex?.acquire();
    try {
      await this.sendCommand(this.metadata.commandName, {
        [this.metadata.idField]: [item.id],
      });
    } finally {
      release?.();
    }
  }

  /**
   * Trigger indexer searches with stagger delays between items
   */
  protected async triggerSearchesWithStagger(items: MediaItem[]): Promise<void> {
    const staggerSeconds = this.settings.stagger_interval_seconds;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      this.logger.debug(
        {
          progress: `${i + 1}/${items.length}`,
          itemId: item.id,
          title: item.title,
        },
        'Triggering indexer search for item'
      );

      await this.triggerItemSearch(item);

      // Interruptible stagger delay
      if (staggerSeconds > 0 && i < items.length - 1 && this.shutdownEmitter) {
        await interruptibleSleep(staggerSeconds * 1000, this.shutdownEmitter);
      }
    }
  }

  /**
   * Fetch items and trigger indexer searches (missing or cutoff)
   */
  private async processBatch(batchType: 'missing' | 'cutoff', limit?: number): Promise<void> {
    const batchSizeSetting =
      batchType === 'missing' ? this.settings.missing_batch_size : this.settings.upgrade_batch_size;
    const batchSize = limit ?? batchSizeSetting;

    // -1 = unlimited, 0 = disabled
    if (batchSize === 0) {
      this.logger.debug(`${batchType} triggers disabled (batch size = 0)`);
      return;
    }

    const params = batchSize > 0 ? { pageSize: batchSize } : undefined;
    const wantedItems = await this.fetchWantedItems(batchType, params);

    if (!wantedItems.records || wantedItems.records.length === 0) {
      const message =
        batchType === 'cutoff'
          ? `No cutoff unmet ${this.metadata.mediaPlural} found`
          : `No missing ${this.metadata.mediaPlural} found`;
      this.logger.info(message);
      return;
    }

    const itemsToTrigger =
      batchSize > 0 ? wantedItems.records.slice(0, batchSize) : wantedItems.records;

    const logMessage =
      batchType === 'cutoff'
        ? `Triggering indexer searches for ${itemsToTrigger.length} cutoff unmet ${this.metadata.mediaPlural}`
        : `Triggering indexer searches for ${itemsToTrigger.length} missing ${this.metadata.mediaPlural}`;

    this.logger.info({ count: itemsToTrigger.length, type: batchType }, logMessage);

    await this.triggerSearchesWithStagger(itemsToTrigger);

    this.logger.info(
      { count: itemsToTrigger.length, type: batchType },
      `Completed triggering ${itemsToTrigger.length} indexer searches`
    );
  }

  /**
   * Trigger indexer searches for missing items
   */
  async triggerMissingSearches(limit?: number): Promise<void> {
    return this.processBatch('missing', limit);
  }

  /**
   * Trigger indexer searches for cutoff unmet items (items that haven't reached quality cutoff)
   */
  async triggerCutoffSearches(limit?: number): Promise<void> {
    return this.processBatch('cutoff', limit);
  }
}
