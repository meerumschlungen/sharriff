/**
 * Core type definitions
 */

export type ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'whisparr';

/**
 * Available search order values
 */
export const SEARCH_ORDER_VALUES = [
  'alphabetical_ascending',
  'alphabetical_descending',
  'last_added_ascending',
  'last_added_descending',
  'last_searched_ascending',
  'last_searched_descending',
  'release_date_ascending',
  'release_date_descending',
  'random',
] as const;

export type SearchOrder = (typeof SEARCH_ORDER_VALUES)[number];

/**
 * Default search order for global settings
 */
export const DEFAULT_SEARCH_ORDER: SearchOrder = 'last_searched_ascending';

export interface GlobalSettings {
  interval: number;
  missing_batch_size: number;
  upgrade_batch_size: number;
  stagger_interval_seconds: number;
  search_order: SearchOrder;
  retry_interval_days: number;
  dry_run: boolean;
}

export interface InstanceConfig {
  type: ArrType;
  host: string;
  api_key: string;
  enabled: boolean;
  weight?: number;
}

export interface Config {
  global: GlobalSettings;
  instances: Record<string, InstanceConfig>;
}

export interface MediaItem {
  id: number;
  title?: string;
  [key: string]: unknown;
}
