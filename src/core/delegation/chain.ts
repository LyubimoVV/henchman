import type { DelegationResult, ChainConfig, DelegationTask } from './types';
import { DelegationExecutor } from './base';
import { logger } from '../logger';

export class ChainExecutor extends DelegationExecutor {
  async execute(config: ChainConfig): Promise<DelegationResult> {
    const { tasks, passResults = true } = config;

    logger.info('subagent', 'Chain: starting sequential execution', {
      tasksCount: tasks.length,
      passResults,
    });

    const results: DelegationResult[] = [];
    let accumulatedContext: Partial<DelegationResult['contextOut']> = {};

    for (let i = 0; i < tasks.length; i++) {
      const currentTask = tasks[i];
      if (!currentTask) continue;

      const task: DelegationTask = {
        id: currentTask.id || this.generateTaskId('chain'),
        description: currentTask.description,
        tools: currentTask.tools,
        context: { ...currentTask.context },
      };

      logger.info('subagent', `Chain: executing task ${i + 1}/${tasks.length}`, {
        taskId: task.id,
      });

      if (passResults && i > 0 && accumulatedContext) {
        task.context = {
          ...task.context,
          ...accumulatedContext,
          previousResult: results[i - 1]?.data,
        };
      }

      const result = await this.executeTask(task);
      results.push(result);

      if (result.status === 'error') {
        logger.error('subagent', 'Chain: task failed, stopping chain', {
          taskId: result.taskId,
          error: result.logs[result.logs.length - 1],
        });
        return result;
      }

      accumulatedContext = {
        ...accumulatedContext,
        ...result.contextOut,
      };
    }

    const lastResult = results[results.length - 1];

    logger.info('subagent', 'Chain: completed successfully', {
      tasksCompleted: results.length,
    });

    return {
      taskId: `chain_${Date.now()}`,
      status: 'success',
      data: {
        finalResult: lastResult?.data,
        allResults: results.map((r) => ({
          taskId: r.taskId,
          data: r.data,
        })),
      },
      contextOut: accumulatedContext,
      logs: results.flatMap((r) => r.logs),
    };
  }
}
