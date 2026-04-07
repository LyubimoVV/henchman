import type {
  DelegationPattern,
  FanOutConfig,
  ChainConfig,
  RouterConfig,
  DelegationResult,
  DelegationExecutorOptions,
  TaskPlan,
  AggregatedResult,
  SubTask,
  VerificationReport,
} from './types';
import { DEFAULT_EXIT_CRITERIA, ErrorType, RETRY_STRATEGIES } from './types';
import { FanOutExecutor } from './fan-out';
import { ChainExecutor } from './chain';
import { RouterExecutor } from './router';
import { TaskPlanner } from './planner';
import { AgentDispatcher } from './dispatcher';
import { FileResourceManager } from './resource-manager';
import { ExitController } from './exit-controller';
import { VerificationGate } from './verification';
import { logger } from '../logger';

export class DelegationManager {
  private options: DelegationExecutorOptions;
  private planner: TaskPlanner;
  private resourceManager: FileResourceManager;
  private dispatcher: AgentDispatcher;
  private verificationGate: VerificationGate;
  private exitController: ExitController;

  constructor(options: DelegationExecutorOptions) {
    this.options = options;

    this.resourceManager = new FileResourceManager();
    this.exitController = new ExitController(DEFAULT_EXIT_CRITERIA);
    this.planner = new TaskPlanner(options);
    this.dispatcher = new AgentDispatcher(options, this.resourceManager, this.exitController);
    this.verificationGate = new VerificationGate();
  }

  async executeWithPlan(goal: string): Promise<AggregatedResult> {
    const startTime = Date.now();
    logger.info('delegation', 'Starting planned execution', { goal: goal.substring(0, 100) });

    const plan = await this.planner.plan(goal);
    logger.info('delegation', `Plan created with ${plan.subtasks.length} subtasks`);

    let attempts = 0;
    let results: DelegationResult[] = [];
    let verification: VerificationReport = {
      planId: plan.id,
      results: [],
      overallStatus: 'failed',
      retryable: false,
    };

    while (attempts < DEFAULT_EXIT_CRITERIA.maxRetries) {
      if (!this.exitController.shouldContinue()) {
        logger.warn('delegation', 'Exit controller stopped execution');
        break;
      }

      results = await this.dispatcher.dispatch(plan);
      verification = this.verificationGate.verify(plan, results);

      if (verification.overallStatus === 'success') {
        logger.info('delegation', 'All tasks completed successfully');
        break;
      }

      if (!verification.retryable) {
        logger.warn('delegation', 'Verification failed, not retryable');
        break;
      }

      if (attempts >= DEFAULT_EXIT_CRITERIA.maxRetries) {
        logger.warn('delegation', 'Max retries exceeded');
        break;
      }

      attempts++;
      const errorType = this.classifyError(verification);
      const retryConfig = RETRY_STRATEGIES[errorType];

      logger.info('delegation', `Retry attempt ${attempts}`, {
        strategy: retryConfig.strategy,
        backoffMs: retryConfig.backoffMs,
      });

      if (retryConfig.strategy === 'fail_fast') {
        break;
      }

      if (retryConfig.strategy === 'replan') {
        logger.info('delegation', 'Replanning due to error');
        const newPlan = await this.planner.plan(goal);
        plan.subtasks = this.mergePlans(plan, newPlan);
      }

      await this.exitController.waitForBackoff(attempts, retryConfig.backoffMs);
    }

    const aggregated = this.aggregateResults(results, plan, startTime);

    logger.info('delegation', 'Planned execution completed', {
      planId: plan.id,
      status: aggregated.status,
      totalSubtasks: aggregated.metadata.totalSubtasks,
      completedSubtasks: aggregated.metadata.completedSubtasks,
      executionTimeMs: aggregated.metadata.executionTimeMs,
    });

    return aggregated;
  }

  async execute(
    pattern: DelegationPattern,
    config: FanOutConfig | ChainConfig | RouterConfig
  ): Promise<DelegationResult[] | DelegationResult> {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('delegation', '[Legacy API] Using execute(), consider migrate to executeWithPlan()');
    }

    logger.delegationStart(pattern, config);

    try {
      let result;
      switch (pattern) {
        case 'fan-out':
          result = await this.fanOut(config as FanOutConfig);
          break;
        case 'chain':
          result = await this.chain(config as ChainConfig);
          break;
        case 'router':
          result = await this.router(config as RouterConfig);
          break;
        default:
          throw new Error(`Unknown delegation pattern: ${pattern}`);
      }
      logger.delegationComplete(pattern, true);
      return result;
    } catch (error) {
      logger.delegationComplete(pattern, false);
      throw error;
    }
  }

  async fanOut(config: FanOutConfig): Promise<DelegationResult[]> {
    const executor = new FanOutExecutor(this.options);
    return executor.execute(config) as Promise<DelegationResult[]>;
  }

  async chain(config: ChainConfig): Promise<DelegationResult> {
    const executor = new ChainExecutor(this.options);
    return executor.execute(config) as Promise<DelegationResult>;
  }

  async router(config: RouterConfig): Promise<DelegationResult> {
    const executor = new RouterExecutor(this.options);
    return executor.execute(config) as Promise<DelegationResult>;
  }

  updateOptions(options: Partial<DelegationExecutorOptions>): void {
    this.options = { ...this.options, ...options };
    this.dispatcher = new AgentDispatcher(this.options, this.resourceManager, this.exitController);
    this.planner = new TaskPlanner(this.options);
  }

  private aggregateResults(
    results: DelegationResult[],
    plan: TaskPlan,
    startTime: number
  ): AggregatedResult {
    const successResults = results.filter(r => r.status === 'success');
    const failedResults = results.filter(r => r.status === 'error');

    let status: 'success' | 'partial' | 'failed' = 'success';
    if (failedResults.length > 0 && successResults.length === 0) {
      status = 'failed';
    } else if (failedResults.length > 0 || successResults.length < plan.subtasks.length) {
      status = 'partial';
    }

    return {
      planId: plan.id,
      goal: plan.goal,
      status,
      data: results.map(r => r.data),
      metadata: {
        totalSubtasks: plan.subtasks.length,
        completedSubtasks: successResults.length,
        failedSubtasks: failedResults.length,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }

  private classifyError(verification: { overallStatus: string }): ErrorType {
    if (verification.overallStatus === 'failed') {
      return ErrorType.CRITICAL_ERROR;
    }
    
    if (verification.overallStatus === 'partial') {
      return ErrorType.EMPTY_RESULT;
    }

    return ErrorType.TIMEOUT;
  }

  private mergePlans(originalPlan: TaskPlan, newPlan: TaskPlan): SubTask[] {
    const mergedSubtasks = [...originalPlan.subtasks];
    
    for (const newSubtask of newPlan.subtasks) {
      const exists = mergedSubtasks.some(st => st.id === newSubtask.id);
      if (!exists) {
        mergedSubtasks.push(newSubtask);
      }
    }

    return mergedSubtasks;
  }

  getResourceManager(): FileResourceManager {
    return this.resourceManager;
  }

  getExitController(): ExitController {
    return this.exitController;
  }
}
