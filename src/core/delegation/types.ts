import type { SubagentContext, ToolDefinition } from '../types';

export type DelegationPattern = 'fan-out' | 'chain' | 'router';

export interface FanOutSharedContext {
  foundFiles: Set<string>;
  searchCache: Map<string, unknown>;
}

export interface DelegationTask {
  id: string;
  description: string;
  tools: string[];
  context?: Partial<SubagentContext>;
  sharedContext?: FanOutSharedContext;
}

export interface DelegationResult {
  taskId: string;
  status: 'success' | 'error' | 'partial' | 'pending';
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
  techStack?: string;
  exitCriteria?: ExitCriteria;
}

export type AnyDelegationConfig = FanOutConfig | ChainConfig | RouterConfig;

export const DEFAULT_EXCLUDE = [
  'node_modules/**',
  'dist/**',
  '.git/**',
  'target/**',
  'bin/**',
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.test.js',
  '**/*.spec.js',
];

export interface ScopeDefinition {
  include: string[];
  exclude?: string[];
  fileTypes?: string[];
}

export interface SubTask {
  id: string;
  description: string;
  scope: ScopeDefinition;
  dependencies: string[];
  tools: string[];
  priority: 'high' | 'medium' | 'low';
  retryConfig?: RetryConfig;
}

export interface TaskPlan {
  id: string;
  goal: string;
  subtasks: SubTask[];
  adjacencyList: Map<string, string[]>;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  createdAt: number;
}

export interface ResourceLock {
  path: string;
  taskId: string;
  acquiredAt: number;
  timeout: number;
}

export enum RetryStrategy {
  RETRY_SAME_PLAN = 'same_plan',
  RETRY_WITH_HINT = 'with_hint',
  REPLAN = 'replan',
  FAIL_FAST = 'fail_fast',
}

export enum ErrorType {
  TIMEOUT = 'TIMEOUT',
  EMPTY_RESULT = 'EMPTY_RESULT',
  INVALID_SCOPE = 'INVALID_SCOPE',
  CRITICAL_ERROR = 'CRITICAL_ERROR',
  FS_LOCK = 'FS_LOCK',
}

export interface RetryConfig {
  strategy: RetryStrategy;
  maxAttempts: number;
  backoffMs: number;
  hint?: string;
}

export interface ExitCriteria {
  maxDepth: number;
  maxRetries: number;
  timeout: number;
  earlyExitOnCacheHit: boolean;
}

export const DEFAULT_EXIT_CRITERIA: ExitCriteria = {
  maxDepth: 3,
  maxRetries: 2,
  timeout: 120000,
  earlyExitOnCacheHit: true,
};

export interface VerificationResult {
  taskId: string;
  covered: string[];
  missed: string[];
  status: 'complete' | 'partial' | 'failed';
  recommendation?: string;
}

export interface VerificationReport {
  planId: string;
  results: VerificationResult[];
  overallStatus: 'success' | 'partial' | 'failed';
  retryable: boolean;
}

export interface AggregatedResult {
  planId: string;
  goal: string;
  status: 'success' | 'partial' | 'failed';
  data: unknown[];
  metadata: {
    totalSubtasks: number;
    completedSubtasks: number;
    failedSubtasks: number;
    executionTimeMs: number;
  };
}

export const RETRY_STRATEGIES: Record<ErrorType, RetryConfig> = {
  [ErrorType.TIMEOUT]: {
    strategy: RetryStrategy.RETRY_SAME_PLAN,
    maxAttempts: 2,
    backoffMs: 1000,
  },
  [ErrorType.FS_LOCK]: {
    strategy: RetryStrategy.RETRY_SAME_PLAN,
    maxAttempts: 2,
    backoffMs: 2000,
  },
  [ErrorType.EMPTY_RESULT]: {
    strategy: RetryStrategy.RETRY_WITH_HINT,
    maxAttempts: 2,
    backoffMs: 500,
    hint: 'Расширить scope или использовать альтернативный поисковый запрос',
  },
  [ErrorType.INVALID_SCOPE]: {
    strategy: RetryStrategy.REPLAN,
    maxAttempts: 1,
    backoffMs: 0,
  },
  [ErrorType.CRITICAL_ERROR]: {
    strategy: RetryStrategy.FAIL_FAST,
    maxAttempts: 0,
    backoffMs: 0,
  },
};
