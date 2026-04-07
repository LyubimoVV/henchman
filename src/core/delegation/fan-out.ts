import type { DelegationResult, FanOutConfig, FanOutSharedContext } from './types';
import { DelegationExecutor } from './base';
import { logger } from '../logger';

export class FanOutExecutor extends DelegationExecutor {
  private sharedContext: FanOutSharedContext = {
    foundFiles: new Set<string>(),
    searchCache: new Map<string, unknown>(),
  };

  async execute(config: FanOutConfig): Promise<DelegationResult[]> {
    const { tasks, concurrency = 3, failFast = false } = config;
    const results: DelegationResult[] = [];

    logger.info('subagent', 'Fan-Out: starting parallel execution', {
      tasksCount: tasks.length,
      concurrency,
      failFast,
    });

    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      
      const batchPromises = batch.map((task) => {
        const taskWithId = {
          ...task,
          id: task.id || this.generateTaskId('fanout'),
          sharedContext: this.sharedContext,
        };
        return this.executeTask(taskWithId);
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);
        
        if (result.contextOut.sharedContext) {
          const sc = result.contextOut.sharedContext;
          if (sc.foundFiles) {
            sc.foundFiles.forEach((f: string) => this.sharedContext.foundFiles.add(f));
          }
          if (sc.searchCache) {
            Object.entries(sc.searchCache).forEach(([k, v]) => 
              this.sharedContext.searchCache.set(k, v)
            );
          }
        }

        if (failFast && result.status === 'error') {
          logger.warn('subagent', 'Fan-Out: stopping due to error (failFast)', {
            taskId: result.taskId,
          });
          return results;
        }
      }
    }

    logger.info('subagent', 'Fan-Out: completed', {
      total: results.length,
      success: results.filter((r) => r.status === 'success').length,
      errors: results.filter((r) => r.status === 'error').length,
      sharedContextStats: {
        foundFiles: this.sharedContext.foundFiles.size,
        cacheSize: this.sharedContext.searchCache.size,
      },
    });

    return results;
  }
}
