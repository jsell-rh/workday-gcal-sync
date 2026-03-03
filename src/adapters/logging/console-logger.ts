import type { Logger, LogContext } from '../../domain/ports/logger';

/**
 * Adapter: Console-based structured logger.
 *
 * Prefixes all messages with [PTO Sync] and formats context as JSON.
 */
export function createConsoleLogger(prefix = 'PTO Sync'): Logger {
  function formatMessage(level: string, message: string, context?: LogContext): string {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${prefix}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  return {
    debug(message: string, context?: LogContext): void {
      console.debug(formatMessage('debug', message, context));
    },
    info(message: string, context?: LogContext): void {
      console.log(formatMessage('info', message, context));
    },
    warn(message: string, context?: LogContext): void {
      console.warn(formatMessage('warn', message, context));
    },
    error(message: string, context?: LogContext): void {
      console.error(formatMessage('error', message, context));
    },
  };
}
