import type { ToolDefinition, ToolResult, JSONSchema } from '../../core/types';
import type {
  DelegationPattern,
  FanOutConfig,
  ChainConfig,
  RouterConfig,
} from '../../core/delegation/types';
import { logger } from '../../core/logger';

type DelegateToolExecutor = (args: Record<string, unknown>) => Promise<ToolResult>;

interface DelegateToolDeps {
  executeDelegation: (
    pattern: DelegationPattern,
    config: FanOutConfig | ChainConfig | RouterConfig
  ) => Promise<unknown>;
}

function createDelegateSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        enum: ['fan-out', 'chain', 'router'],
        description: 'Delegation pattern for task execution. Required.',
      },
      config: {
        type: 'object',
        description: 'Configuration for the delegation pattern. Required.',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks for fan-out or chain patterns',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Optional task ID' },
                description: { type: 'string', description: 'Task description for subagent' },
                tools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of tool names available to subagent',
                },
                context: { type: 'object', description: 'Optional context for subagent' },
              },
              required: ['description', 'tools'],
            },
          },
          concurrency: {
            type: 'number',
            description: 'Max parallel tasks (fan-out only, default: 3)',
          },
          failFast: {
            type: 'boolean',
            description: 'Stop on first error (fan-out only, default: false)',
          },
          passResults: {
            type: 'boolean',
            description: 'Pass previous result to next task (chain only, default: true)',
          },
          routes: {
            type: 'array',
            description: 'Route definitions (router only)',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Route name' },
                description: { type: 'string', description: 'Route description for matching' },
                task: { type: 'object', description: 'Task to execute if route matches' },
              },
              required: ['name', 'description', 'task'],
            },
          },
          input: {
            type: 'string',
            description: 'Input to route (router only)',
          },
          defaultTask: {
            type: 'object',
            description: 'Default task if no route matches (router only)',
          },
        },
      },
    },
    required: ['pattern', 'config'],
  };
}

export function createDelegateTool(deps: DelegateToolDeps): ToolDefinition {
  const execute: DelegateToolExecutor = async (args: Record<string, unknown>) => {
    const pattern = args['pattern'] as DelegationPattern;
    const config = args['config'] as FanOutConfig | ChainConfig | RouterConfig;

    if (!pattern || !config) {
      return {
        success: false,
        result: null,
        error: 'Both "pattern" and "config" are required',
      };
    }

    logger.info('tool', 'Delegate tool called', { pattern });

    try {
      const result = await deps.executeDelegation(pattern, config);

      return {
        success: true,
        result: {
          pattern,
          data: result,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('tool', 'Delegate tool failed', { error: err.message });
      return {
        success: false,
        result: null,
        error: err.message,
      };
    }
  };

  return {
    name: 'delegate',
    category: 'system',
    description:
      'Delegate tasks to specialized subagents who have direct access to search and file tools. ' +
      'YOU MUST USE THIS TOOL FOR ALL tasks requiring file search, code analysis, or file reading. ' +
      'Subagent tools: glob_search, content_search, rag_search, read_file, list_files. ' +
      'Patterns: fan-out (parallel), chain (sequential), router (conditional). ' +
      'Examples: ' +
      'delegate({pattern:"fan-out",config:{tasks:[{description:"Find DeepSeekClient class",tools:["glob_search","rag_search","read_file"]}]}}) ' +
      'delegate({pattern:"fan-out",config:{tasks:[{description:"Analyze authentication flow",tools:["rag_search","content_search","read_file"]}]}}) ' +
      'delegate({pattern:"chain",config:{tasks:[{description:"Find all Service classes",tools:["glob_search"]},{description:"Read and summarize each",tools:["read_file"]}]}})',
    parameters: createDelegateSchema(),
    execute,
  };
}
