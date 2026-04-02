import type { ToolDefinition, ToolResult, ToolError, ErrorHandler } from './types';
import { toolRegistry } from './tool-registry';
import { logger } from './logger';
import { createErrorHandler } from './error-handler';

export interface ExecutorOptions {
  errorHandler?: ErrorHandler;
  timeout?: number;
}

export class ToolExecutor {
  private errorHandler: ErrorHandler;
  private timeout: number;

  constructor(options: ExecutorOptions = {}) {
    this.errorHandler = options.errorHandler ?? createErrorHandler('default');
    this.timeout = options.timeout ?? 30000;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    maxRetries: number = 3
  ): Promise<ToolResult> {
    const tool = toolRegistry.getByName(toolName);

    if (!tool) {
      logger.error('tool', `Tool not found: ${toolName}`);
      return {
        success: false,
        result: null,
        error: `Tool "${toolName}" not found in registry`,
      };
    }

    const startTime = Date.now();
    logger.toolCall(toolName, args);

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;

      try {
        const result = await this.executeWithTimeout(tool, args);
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
          args,
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
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${this.timeout}ms`));
      }, this.timeout);

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
