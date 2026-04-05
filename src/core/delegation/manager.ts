import type {
  DelegationPattern,
  FanOutConfig,
  ChainConfig,
  RouterConfig,
  DelegationResult,
  DelegationExecutorOptions,
} from './types';
import { FanOutExecutor } from './fan-out';
import { ChainExecutor } from './chain';
import { RouterExecutor } from './router';
import { logger } from '../logger';

export class DelegationManager {
  private options: DelegationExecutorOptions;

  constructor(options: DelegationExecutorOptions) {
    this.options = options;
  }

  async execute(
    pattern: DelegationPattern,
    config: FanOutConfig | ChainConfig | RouterConfig
  ): Promise<DelegationResult[] | DelegationResult> {
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
  }
}
