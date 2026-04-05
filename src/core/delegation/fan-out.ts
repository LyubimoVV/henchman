import type { DelegationResult, FanOutConfig } from './types';
import { DelegationExecutor } from './base';
import { logger } from '../logger';

export class FanOutExecutor extends DelegationExecutor {
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
        };
        return this.executeTask(taskWithId);
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);

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
    });

    return results;
  }
}
