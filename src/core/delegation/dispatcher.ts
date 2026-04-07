import type { 
  DelegationExecutorOptions, 
  TaskPlan, 
  SubTask, 
  DelegationResult,
  DelegationTask,
  FanOutSharedContext
} from './types';
import { FileResourceManager } from './resource-manager';
import { ExitController } from './exit-controller';
import { DelegationExecutor } from './base';
import { logger } from '../logger';

export class AgentDispatcher extends DelegationExecutor {
  private resourceManager: FileResourceManager;
  private exitController: ExitController;

  constructor(
    options: DelegationExecutorOptions,
    resourceManager: FileResourceManager,
    exitController: ExitController
  ) {
    super(options);
    this.resourceManager = resourceManager;
    this.exitController = exitController;
  }

  async execute(_config: unknown): Promise<DelegationResult[]> {
    throw new Error('AgentDispatcher.execute() is not implemented. Use dispatch(plan) instead.');
  }

  async dispatch(plan: TaskPlan): Promise<DelegationResult[]> {
    logger.info('delegation', 'Starting task dispatch', {
      planId: plan.id,
      subtaskCount: plan.subtasks.length,
    });

    const layers = this.topologicalSort(plan.subtasks, plan.adjacencyList);
    logger.debug('delegation', `Created ${layers.length} execution layers`, {
      layers: layers.map(l => ({ count: l.length, tasks: l.map(t => t.id) })),
    });

    const allResults: DelegationResult[] = [];
    const sharedContext: FanOutSharedContext = {
      foundFiles: new Set<string>(),
      searchCache: new Map<string, unknown>(),
    };

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      if (!this.exitController.shouldContinue()) {
        logger.warn('delegation', 'Exit controller stopped execution', {
          layerIndex,
          totalLayers: layers.length,
        });
        break;
      }

      const layer = layers[layerIndex];
      
      if (!layer) {
        logger.warn('delegation', `Layer ${layerIndex} is undefined, skipping`);
        continue;
      }

      logger.info('delegation', `Executing layer ${layerIndex + 1}/${layers.length}`, {
        tasksInLayer: layer.length,
        taskIds: layer.map(t => t.id),
      });

      const reservedTasks = this.reserveLayerResources(layer);
      
      if (reservedTasks.length === 0) {
        logger.warn('delegation', 'No tasks could reserve resources, skipping layer');
        continue;
      }

      const layerResults = await this.executeLayer(reservedTasks, sharedContext, plan);
      allResults.push(...layerResults);

      this.mergeSharedContext(layerResults, sharedContext);

      this.releaseLayerResources(reservedTasks);

      this.exitController.incrementDepth();
    }

    logger.info('delegation', 'Task dispatch completed', {
      totalResults: allResults.length,
      successCount: allResults.filter(r => r.status === 'success').length,
      errorCount: allResults.filter(r => r.status === 'error').length,
    });

    return allResults;
  }

  private topologicalSort(
    subtasks: SubTask[],
    adjacencyList: Map<string, string[]>
  ): SubTask[][] {
    const inDegree = new Map<string, number>();
    const taskMap = new Map<string, SubTask>();

    for (const subtask of subtasks) {
      taskMap.set(subtask.id, subtask);
      inDegree.set(subtask.id, 0);
    }

    for (const [taskId, dependencies] of adjacencyList) {
      for (const depId of dependencies) {
        if (inDegree.has(depId)) {
          const currentDegree = inDegree.get(taskId) ?? 0;
          inDegree.set(taskId, currentDegree + 1);
        }
      }
    }

    const layers: SubTask[][] = [];
    const processed = new Set<string>();

    while (processed.size < subtasks.length) {
      const currentLayer: SubTask[] = [];

      for (const [taskId, degree] of inDegree) {
        if (degree === 0 && !processed.has(taskId)) {
          const task = taskMap.get(taskId);
          if (task) {
            currentLayer.push(task);
          }
        }
      }

      if (currentLayer.length === 0) {
        logger.warn('delegation', 'Circular dependency detected in topological sort');
        const remaining = subtasks.filter(st => !processed.has(st.id));
        if (remaining.length > 0) {
          layers.push(remaining);
          remaining.forEach(st => processed.add(st.id));
        }
        break;
      }

      layers.push(currentLayer);

      for (const task of currentLayer) {
        processed.add(task.id);
        
        for (const [taskId, dependencies] of adjacencyList) {
          if (dependencies.includes(task.id)) {
            const currentDegree = inDegree.get(taskId) ?? 0;
            inDegree.set(taskId, currentDegree - 1);
          }
        }
      }
    }

    return layers;
  }

  private reserveLayerResources(layer: SubTask[]): SubTask[] {
    const reservedTasks: SubTask[] = [];

    for (const subtask of layer) {
      const pathsToReserve = subtask.scope.include;
      
      if (this.resourceManager.reserve(pathsToReserve, subtask.id)) {
        reservedTasks.push(subtask);
        logger.debug('delegation', `Reserved resources for task "${subtask.id}"`, {
          taskId: subtask.id,
          paths: pathsToReserve.slice(0, 3),
        });
      } else {
        logger.warn('delegation', `Failed to reserve resources for task "${subtask.id}", skipping`, {
          taskId: subtask.id,
          requestedPaths: pathsToReserve.length,
        });
      }
    }

    return reservedTasks;
  }

  private async executeLayer(
    layer: SubTask[],
    sharedContext: FanOutSharedContext,
    plan: TaskPlan
  ): Promise<DelegationResult[]> {
    const delegationTasks: DelegationTask[] = layer.map(subtask => ({
      id: subtask.id,
      description: subtask.description,
      tools: subtask.tools,
      sharedContext,
      context: {
        allowedScope: subtask.scope,
        planGoal: plan.goal,
      },
    }));

    const batchPromises = delegationTasks.map(task => this.executeTask(task));
    const results = await Promise.all(batchPromises);

    return results;
  }

  private mergeSharedContext(
    results: DelegationResult[],
    sharedContext: FanOutSharedContext
  ): void {
    for (const result of results) {
      if (result.contextOut.sharedContext) {
        const sc = result.contextOut.sharedContext;
        
        if (sc.foundFiles) {
          sc.foundFiles.forEach((f: string) => sharedContext.foundFiles.add(f));
        }
        
        if (sc.searchCache) {
          Object.entries(sc.searchCache).forEach(([k, v]) => {
            sharedContext.searchCache.set(k, v);
          });
        }
      }
    }

    logger.debug('delegation', 'Merged shared context', {
      foundFilesCount: sharedContext.foundFiles.size,
      cacheSize: sharedContext.searchCache.size,
    });
  }

  private releaseLayerResources(layer: SubTask[]): void {
    for (const subtask of layer) {
      this.resourceManager.release(subtask.id);
    }
    
    logger.debug('delegation', `Released resources for ${layer.length} tasks`);
  }
}
