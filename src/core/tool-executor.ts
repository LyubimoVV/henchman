import type { ToolDefinition, ToolResult, ToolError, ErrorHandler } from './types';
import { toolRegistry } from './tool-registry';
import { logger } from './logger';
import { createErrorHandler } from './error-handler';

const TOOL_TIMEOUTS: Record<string, number> = {
  delegate: 120000,
  bash: 60000,
  default: 30000,
};

export interface ExecutorOptions {
  errorHandler?: ErrorHandler;
  timeout?: number;
}

export class ToolExecutor {
  private errorHandler: ErrorHandler;
  private defaultTimeout: number;

  constructor(options: ExecutorOptions = {}) {
    this.errorHandler = options.errorHandler ?? createErrorHandler('default');
    this.defaultTimeout = options.timeout ?? 30000;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    maxRetries: number = 3,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    let tool = toolRegistry.getByName(toolName);

    if (!tool) {
      logger.error('tool', `Tool not found: ${toolName}`);
      return {
        success: false,
        result: null,
        error: `Tool "${toolName}" not found in registry`,
      };
    }

    // Нормализация аргументов для content_search
    const normalizedArgs = this.normalizeContentSearchArgs(toolName, args);

    const startTime = Date.now();
    logger.toolCall(toolName, normalizedArgs);

    let attempt = 0;
    while (attempt < maxRetries) {
      if (signal?.aborted) {
        return {
          success: false,
          result: null,
          error: 'Execution aborted',
        };
      }
      attempt++;

      try {
        const result = await this.executeWithTimeout(tool, normalizedArgs);
        const duration = Date.now() - startTime;
        logger.toolResult(toolName, true, duration);

        return {
          success: true,
          result,
        };
      } catch (error) {
    const toolError: ToolError = {
          toolName,
          error: error instanceof Error ? error : new Error(String(error)),
          args: normalizedArgs,
          attempt,
        };

        const strategy = await this.errorHandler.handle(toolError);

        switch (strategy) {
          case 'retry':
            continue;
          case 'abort':
            logger.toolResult(toolName, false, Date.now() - startTime);
            return {
              success: false,
              result: null,
              error: toolError.error.message,
            };
          case 'fallback':
            return this.executeFallback(tool, args);
          case 'ask_user':
            return {
              success: false,
              result: null,
              error: `User intervention required: ${toolError.error.message}`,
            };
        }
      }
    }

    return {
      success: false,
      result: null,
      error: `Max retries (${maxRetries}) exceeded`,
    };
  }

  private async executeWithTimeout(
    tool: ToolDefinition,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const timeout = TOOL_TIMEOUTS[tool.name] ?? this.defaultTimeout;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      tool.execute(args)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private normalizeContentSearchArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (toolName !== 'content_search') {
      return args;
    }

    // Автоисправление: query → pattern
    if (!args['pattern'] && args['query']) {
      logger.warn('tool', 'Auto-correcting content_search: "query" → "pattern" (use "pattern" parameter directly)');
      const normalized = { ...args, pattern: args['query'] };
      delete (normalized as Record<string, unknown>).query;
      return normalized;
    }

    // Строгий режим (если задан в config)
    if (process.env.STRICT_TOOL_ARGS === 'true' && !args['pattern']) {
      logger.error('tool', 'content_search requires "pattern" parameter (not "query")');
      throw new Error('content_search requires "pattern" parameter. Example: content_search({pattern: "class UserService", fileTypes: ["java"]})');
    }

    return args;
  }

  private async executeFallback(
    tool: ToolDefinition,
    _args: Record<string, unknown>
  ): Promise<ToolResult> {
    logger.warn('tool', `Executing fallback for ${tool.name}`);
    return {
      success: false,
      result: null,
      error: 'Fallback executed - no result available',
    };
  }
}

export const toolExecutor = new ToolExecutor();
