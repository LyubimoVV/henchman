import type { ExitCriteria } from './types';
import { DEFAULT_EXIT_CRITERIA } from './types';
import { logger } from '../logger';

export class ExitController {
  private depth: number = 0;
  private retries: Map<string, number> = new Map();
  private startTime: number;
  private criteria: ExitCriteria;

  constructor(criteria: ExitCriteria = DEFAULT_EXIT_CRITERIA) {
    this.criteria = criteria;
    this.startTime = Date.now();
  }

  shouldContinue(taskId?: string): boolean {
    if (this.depth > this.criteria.maxDepth) {
      logger.warn('delegation', 'Max depth exceeded, stopping delegation', {
        depth: this.depth,
        maxDepth: this.criteria.maxDepth,
      });
      return false;
    }

    if (taskId) {
      const taskRetries = this.retries.get(taskId) ?? 0;
      if (taskRetries >= this.criteria.maxRetries) {
        logger.warn('delegation', `Max retries exceeded for task "${taskId}"`, {
          taskId,
          retries: taskRetries,
          maxRetries: this.criteria.maxRetries,
        });
        return false;
      }
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.criteria.timeout) {
      logger.warn('delegation', 'Timeout exceeded, stopping delegation', {
        elapsed,
        timeout: this.criteria.timeout,
      });
      return false;
    }

    return true;
  }

  shouldEarlyExit(cacheKey: string, resourceManager: { hasCachedResult: (key: string) => boolean }): boolean {
    if (!this.criteria.earlyExitOnCacheHit) {
      return false;
    }

    if (resourceManager.hasCachedResult(cacheKey)) {
      logger.info('delegation', 'Early exit triggered by cache hit', {
        cacheKey: cacheKey.substring(0, 50),
      });
      return true;
    }

    return false;
  }

  incrementDepth(): void {
    this.depth++;
    logger.debug('delegation', `Depth incremented to ${this.depth}`, {
      depth: this.depth,
      maxDepth: this.criteria.maxDepth,
    });
  }

  decrementDepth(): void {
    if (this.depth > 0) {
      this.depth--;
      logger.debug('delegation', `Depth decremented to ${this.depth}`);
    }
  }

  incrementRetry(taskId: string): number {
    const currentRetries = this.retries.get(taskId) ?? 0;
    const newRetries = currentRetries + 1;
    this.retries.set(taskId, newRetries);
    
    logger.debug('delegation', `Retry count incremented for task "${taskId}"`, {
      taskId,
      retries: newRetries,
      maxRetries: this.criteria.maxRetries,
    });
    
    return newRetries;
  }

  getRetries(taskId: string): number {
    return this.retries.get(taskId) ?? 0;
  }

  getDepth(): number {
    return this.depth;
  }

  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.depth = 0;
    this.retries.clear();
    this.startTime = Date.now();
    logger.debug('delegation', 'Exit controller reset');
  }

  getStats(): {
    depth: number;
    maxDepth: number;
    totalRetries: number;
    elapsedTime: number;
    timeout: number;
  } {
    return {
      depth: this.depth,
      maxDepth: this.criteria.maxDepth,
      totalRetries: Array.from(this.retries.values()).reduce((sum, r) => sum + r, 0),
      elapsedTime: this.getElapsedTime(),
      timeout: this.criteria.timeout,
    };
  }

  calculateBackoff(attempt: number, baseMs: number): number {
    return baseMs * Math.pow(2, attempt - 1);
  }

  async waitForBackoff(attempt: number, baseMs: number): Promise<void> {
    const backoffMs = this.calculateBackoff(attempt, baseMs);
    
    if (backoffMs > 0) {
      logger.debug('delegation', `Waiting for backoff`, {
        attempt,
        backoffMs,
        baseMs,
      });
      
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}
