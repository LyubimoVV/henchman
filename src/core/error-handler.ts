import type { ToolError, ErrorStrategy, ErrorHandler } from './types';
import { logger } from './logger';

export class DefaultErrorHandler implements ErrorHandler {
  private maxRetries: number;
  private retryableErrors: string[];

  constructor(maxRetries: number = 3, retryableErrors?: string[]) {
    this.maxRetries = maxRetries;
    this.retryableErrors = retryableErrors ?? [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'rate_limit',
      'overloaded',
    ];
  }

  async handle(error: ToolError): Promise<ErrorStrategy> {
    const errorMessage = error.error.message.toLowerCase();
    const isErrorRetryable = this.retryableErrors.some((retryable) =>
      errorMessage.includes(retryable.toLowerCase())
    );

    logger.error('system', `Tool error: ${error.toolName}`, {
      attempt: error.attempt,
      error: error.error.message,
      retryable: isErrorRetryable,
    });

    if (error.attempt < this.maxRetries && isErrorRetryable) {
      const delay = Math.min(1000 * Math.pow(2, error.attempt), 10000);
      logger.warn('system', `Retrying in ${delay}ms`, { tool: error.toolName });
      await this.sleep(delay);
      return 'retry';
    }

    if (error.attempt >= this.maxRetries) {
      logger.error('system', `Max retries exceeded for ${error.toolName}`);
      return 'abort';
    }

    return 'abort';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class StrictErrorHandler implements ErrorHandler {
  async handle(error: ToolError): Promise<ErrorStrategy> {
    logger.error('system', `Strict mode: aborting on error`, {
      tool: error.toolName,
      error: error.error.message,
    });
    return 'abort';
  }
}

export class InteractiveErrorHandler implements ErrorHandler {
  private askUserCallback: (error: ToolError) => Promise<ErrorStrategy>;

  constructor(askUserCallback: (error: ToolError) => Promise<ErrorStrategy>) {
    this.askUserCallback = askUserCallback;
  }

  async handle(error: ToolError): Promise<ErrorStrategy> {
    logger.error('system', `Tool error occurred`, {
      tool: error.toolName,
      error: error.error.message,
    });
    return this.askUserCallback(error);
  }
}

export function createErrorHandler(
  mode: 'default' | 'strict' | 'interactive' = 'default',
  options?: { maxRetries?: number; askUserCallback?: (error: ToolError) => Promise<ErrorStrategy> }
): ErrorHandler {
  switch (mode) {
    case 'strict':
      return new StrictErrorHandler();
    case 'interactive':
      if (!options?.askUserCallback) {
        throw new Error('InteractiveErrorHandler requires askUserCallback');
      }
      return new InteractiveErrorHandler(options.askUserCallback);
    default:
      return new DefaultErrorHandler(options?.maxRetries);
  }
}
