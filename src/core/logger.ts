import pc from 'picocolors';
import type { LogLevel, LogCategory, LogEntry } from './types';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const CATEGORY_COLORS: Record<LogCategory, (str: string) => string> = {
  main: pc.cyan,
  subagent: pc.green,
  rag: pc.magenta,
  mcp: pc.blue,
  system: pc.gray,
  tool: pc.yellow,
  delegation: pc.blue,
};

const LEVEL_COLORS: Record<LogLevel, (str: string) => string> = {
  debug: pc.gray,
  info: pc.white,
  warn: pc.yellow,
  error: pc.red,
  silent: pc.gray,
};

class Logger {
  private minLevel: LogLevel;
  private debugMode: boolean;
  private paused: boolean = false;
  private pendingLogs: string[] = [];

  constructor(minLevel: LogLevel = 'silent', debugMode: boolean = false) {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) ?? minLevel;
    this.debugMode = debugMode;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (enabled) {
      this.minLevel = 'debug';
    } else if (this.minLevel === 'debug') {
      this.minLevel = 'error';
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().substring(11, 23);
  }

  private formatEntry(entry: LogEntry): string {
    const prefix = entry.category === 'main' ? '[Orchestrator] ' :
                 entry.category === 'subagent' ? '[Subagent] ' :
                 entry.category === 'delegation' ? '[Delegation] ' :
                 '';

    const timestamp = pc.gray(`[${this.formatTimestamp(entry.timestamp)}]`);
    const category = CATEGORY_COLORS[entry.category](entry.category.padEnd(10));
    const level = LEVEL_COLORS[entry.level](entry.level.toUpperCase().padEnd(5));
    const message = LEVEL_COLORS[entry.level](entry.message);

    let formatted = `${prefix}${timestamp} ${category} ${level} ${message}`;

    if (this.debugMode && entry.meta && Object.keys(entry.meta).length > 0) {
      formatted += pc.gray(` ${JSON.stringify(entry.meta)}`);
    }

    return formatted;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pendingLogs.forEach(log => console.error(log));
    this.pendingLogs = [];
  }

  async withPaused<T>(fn: () => Promise<T>): Promise<T> {
    this.pause();
    try {
      return await fn();
    } finally {
      this.resume();
    }
  }

  log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;
    const output = this.formatEntry(entry);
    
    if (this.paused) {
      this.pendingLogs.push(output);
    } else {
      console.error(output);
    }
  }

  private createEntry(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: Record<string, unknown>
  ): LogEntry {
    return {
      timestamp: new Date(),
      level,
      category,
      message,
      meta,
    };
  }

  debug(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log(this.createEntry('debug', category, message, meta));
  }

  info(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log(this.createEntry('info', category, message, meta));
  }

  warn(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log(this.createEntry('warn', category, message, meta));
  }

  error(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log(this.createEntry('error', category, message, meta));
  }

  toolCall(toolName: string, args: Record<string, unknown>): void {
    this.info('tool', `Calling: ${toolName}`, args);
  }

  toolResult(toolName: string, success: boolean, duration?: number): void {
    const status = success ? '✓' : '✗';
    const durationStr = duration !== undefined ? ` (${duration}ms)` : '';
    this.info('tool', `${status} ${toolName}${durationStr}`);
  }

  subagentSpawn(taskId: string, description: string): void {
    this.info('subagent', `Spawning: ${taskId}`, { description });
  }

  subagentComplete(taskId: string, status: 'success' | 'error' | 'partial'): void {
    const icon = status === 'success' ? '✓' : status === 'partial' ? '⚠' : '✗';
    this.info('subagent', `${icon} Completed: ${taskId}`, { status });
  }

  delegationStart(pattern: string, _config: unknown): void {
    this.info('delegation', `Starting delegation`, { pattern });
  }

  delegationComplete(pattern: string, success: boolean): void {
    const icon = success ? '✓' : '✗';
    this.info('delegation', `${icon} Delegation complete`, { pattern, success });
  }

  ragOperation(operation: string, meta?: Record<string, unknown>): void {
    this.debug('rag', operation, meta);
  }

  mcpCall(method: string): void {
    this.debug('mcp', `Calling: ${method}`);
  }
}

export const logger = new Logger();
export { Logger };
