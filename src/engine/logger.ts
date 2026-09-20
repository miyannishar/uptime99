/**
 * Comprehensive logging system for the engine.
 *
 * Usage:
 *   const log = createLogger('module-name')
 *   log.debug('message', { data: 123 })
 *   log.info('important event', { key: 'value' })
 *   log.warn('something amiss', { status: 'bad' })
 *   log.error('critical failure', { reason: 'timeout' })
 *
 * Global controls:
 *   setGlobalLogLevel('debug')  // 'debug' | 'info' | 'warn' | 'error'
 *   setConsoleEnabled(true)     // enable/disable console output
 *   getAllLogs()                // fetch all accumulated logs
 *   clearAllLogs()              // reset log history
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

class Logger {
  private logs: LogEntry[] = [];
  private level: LogLevel = 'info';
  private enableConsole = true; // Always log to console (Node & browser)

  constructor(private module: string) {}

  setLevel(level: LogLevel) {
    this.level = level;
  }

  setEnableConsole(enable: boolean) {
    this.enableConsole = enable;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.level];
  }

  private formatLog(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toISOString().slice(11, 23);
    const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    return `[${time}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${dataStr}`;
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module: this.module,
      message,
      data,
    };

    this.logs.push(entry);

    if (this.enableConsole) {
      const formatted = this.formatLog(entry);
      const consoleFn = console[level as keyof Omit<Console, 'assert' | 'clear' | 'time' | 'timeEnd' | 'timeLog' | 'table' | 'trace' | 'profile' | 'profileEnd' | 'dir' | 'dirxml' | 'count' | 'countReset' | 'assert' | 'context' | 'Console' | 'memory' | 'markTimeline' | 'timeline' | 'timelineEnd'>] || console.log;
      if (typeof consoleFn === 'function') {
        (consoleFn as any)(formatted);
      }
    }

    syncLogsToServer();
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }

  getLogsSince(timestamp: number): LogEntry[] {
    return this.logs.filter(l => l.timestamp >= timestamp);
  }
}

const loggers = new Map<string, Logger>();
const globalLevel: { level: LogLevel } = { level: 'info' };
let lastSyncTime = Date.now();

export function createLogger(module: string): Logger {
  if (!loggers.has(module)) {
    const logger = new Logger(module);
    logger.setLevel(globalLevel.level);
    loggers.set(module, logger);
  }
  return loggers.get(module)!;
}

function syncLogsToServer() {
  if (typeof window === 'undefined' || !window.fetch) return;
  const now = Date.now();
  const allLogs = getAllLogs();
  const newLogs = allLogs.filter(l => l.timestamp >= lastSyncTime);
  if (newLogs.length > 0) {
    lastSyncTime = now;
    fetch('/__engine_log__', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLogs),
      keepalive: true,
    }).catch(() => {
      // ignore network errors
    });
  }
}

export function setGlobalLogLevel(level: LogLevel) {
  globalLevel.level = level;
  loggers.forEach(logger => logger.setLevel(level));
}

export function setConsoleEnabled(enabled: boolean) {
  loggers.forEach(logger => logger.setEnableConsole(enabled));
}

export function getAllLogs(): LogEntry[] {
  const all: LogEntry[] = [];
  loggers.forEach(logger => all.push(...logger.getLogs()));
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

export function clearAllLogs() {
  loggers.forEach(logger => logger.clearLogs());
}
