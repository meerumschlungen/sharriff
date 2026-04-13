/**
 * Configuration loader and validator
 */

import { z } from 'zod';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { Config } from '../types.js';
import { SEARCH_ORDER_VALUES, DEFAULT_SEARCH_ORDER } from '../types.js';
import { logger } from '../logger.js';

// Zod schemas
const ArrTypeSchema = z.enum(['radarr', 'sonarr', 'lidarr']);

const SearchOrderSchema = z.enum(SEARCH_ORDER_VALUES);

const GlobalSettingsSchema = z.object({
  interval: z.number().positive().default(3600),
  missing_batch_size: z.number().min(-1).default(20),
  upgrade_batch_size: z.number().min(-1).default(10),
  stagger_interval_seconds: z.number().min(0).default(30),
  search_order: SearchOrderSchema.default(DEFAULT_SEARCH_ORDER),
  retry_interval_days: z.number().min(0).default(0),
  dry_run: z.boolean().default(false),
});

const InstanceConfigSchema = z.object({
  type: ArrTypeSchema,
  host: z.string().min(1),
  api_key: z.string().min(1),
  enabled: z.boolean().default(true),
  weight: z.number().positive().default(1.0),
});

const ConfigSchema = z
  .object({
    global: GlobalSettingsSchema.optional(),
    instances: z
      .record(z.string(), InstanceConfigSchema)
      .refine((instances) => Object.keys(instances).length > 0, {
        message: 'At least one instance must be defined',
      }),
  })
  .transform((data) => ({
    global: data.global ?? GlobalSettingsSchema.parse({}),
    instances: data.instances,
  }));

/**
 * Load configuration from file
 * Requires SHARRIFF_CONFIG_FILE environment variable
 */
export function loadConfig(): Config {
  const filePath = process.env['SHARRIFF_CONFIG_FILE'];

  if (!filePath) {
    throw new Error('SHARRIFF_CONFIG_FILE environment variable is required');
  }

  logger.debug({ filePath }, 'Loading configuration from file');

  let yamlContent: string;
  try {
    yamlContent = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read configuration file '${filePath}': ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return parseConfig(yamlContent);
}

/**
 * Interpolate environment variables in YAML content
 * Supports ${VAR_NAME} syntax
 */
function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(
        `Environment variable '${varName}' is not defined. Required for interpolation in config.`
      );
    }
    return value;
  });
}

/**
 * Parse and validate YAML configuration string
 */
export function parseConfig(yamlContent: string): Config {
  let rawConfig: unknown;

  // Interpolate environment variables before parsing
  const interpolated = interpolateEnvVars(yamlContent);

  try {
    rawConfig = parse(interpolated);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Configuration validation failed:\n  - ${issues.join('\n  - ')}`);
    }
    throw error;
  }
}
