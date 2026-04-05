import type { SubagentContext, ToolDefinition } from '../types';

export type DelegationPattern = 'fan-out' | 'chain' | 'router';

export interface DelegationTask {
  id: string;
  description: string;
  tools: string[];
  context?: Partial<SubagentContext>;
}

export interface DelegationResult {
  taskId: string;
  status: 'success' | 'error';
  data: unknown;
  contextOut: Partial<SubagentContext>;
  logs: string[];
}

export interface FanOutConfig {
  tasks: DelegationTask[];
  concurrency: number;
  failFast: boolean;
}

export interface ChainConfig {
  tasks: DelegationTask[];
  passResults: boolean;
}

export interface RouterRoute {
  name: string;
  description: string;
  task: DelegationTask;
}

export interface RouterConfig {
  routes: RouterRoute[];
  input: string;
  defaultTask?: DelegationTask;
}

export interface DelegationExecutorOptions {
  projectPath: string;
  gitBranch?: string;
  indexedFiles: string[];
  subagentTools: ToolDefinition[];
}

export type AnyDelegationConfig = FanOutConfig | ChainConfig | RouterConfig;
