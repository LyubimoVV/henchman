import type { DelegationResult, RouterConfig, RouterRoute } from './types';
import { DelegationExecutor } from './base';
import { llmClient } from '../../llm/client';
import { logger } from '../logger';

export class RouterExecutor extends DelegationExecutor {
  async execute(config: RouterConfig): Promise<DelegationResult> {
    const { routes, input, defaultTask } = config;

    logger.info('subagent', 'Router: analyzing input for routing', {
      routesCount: routes.length,
      inputLength: input.length,
    });

    const selectedRoute = await this.selectRoute(routes, input);

    if (!selectedRoute) {
      if (defaultTask) {
        logger.info('subagent', 'Router: using default task');
        return this.executeTask({
          ...defaultTask,
          id: defaultTask.id || this.generateTaskId('router_default'),
        });
      }

      return {
        taskId: this.generateTaskId('router_failed'),
        status: 'error',
        data: null,
        contextOut: {},
        logs: ['Router: no matching route found and no default task'],
      };
    }

    logger.info('subagent', 'Router: route selected', {
      routeName: selectedRoute.name,
    });

    const task = {
      ...selectedRoute.task,
      id: selectedRoute.task.id || this.generateTaskId(`router_${selectedRoute.name}`),
    };

    return this.executeTask(task);
  }

  private async selectRoute(routes: RouterRoute[], input: string): Promise<RouterRoute | null> {
    const routesDescription = routes
      .map((r, i) => `${i + 1}. "${r.name}": ${r.description}`)
      .join('\n');

    const systemPrompt = `You are a router that selects the most appropriate handler for a user request.

Available routes:
${routesDescription}

Analyze the user request and return ONLY the route name that best matches.
Return ONLY the route name, nothing else. If no route matches, return "none".`;

    try {
      const response = await llmClient.chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0.1,
        maxTokens: 50,
      });

      const selectedName = response.content?.trim().toLowerCase();

      if (!selectedName || selectedName === 'none') {
        return null;
      }

      return routes.find(
        (r) => r.name.toLowerCase() === selectedName
      ) || null;
    } catch (error) {
      logger.error('subagent', 'Router: failed to select route', {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
