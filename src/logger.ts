/**
 * Structured logging configuration
 * - Development mode: Pretty, human-readable logs
 * - Production mode: JSON structured logs
 */

import pino from 'pino';
import type { LoggerOptions } from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';
const logLevel = process.env['LOG_LEVEL'] ?? (isDevelopment ? 'debug' : 'info');
const logFormat = process.env['LOG_FORMAT'] ?? (isDevelopment ? 'pretty' : 'json');
const timezone = process.env['TZ'] ?? 'UTC';

/**
 * Create logger options based on environment
 */
function getLoggerOptions(): LoggerOptions {
  if (logFormat === 'pretty') {
    // Use SYS: prefix to respect TZ environment variable, or UTC: to force UTC
    const timeFormat = timezone === 'UTC' ? 'UTC:yyyy-mm-dd HH:MM:ss' : 'SYS:yyyy-mm-dd HH:MM:ss';

    return {
      level: logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: timeFormat,
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    };
  }

  // Default to JSON format
  return {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'sharriff' },
  };
}

/**
 * Create and configure the logger
 */
export const logger = pino(getLoggerOptions());

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
