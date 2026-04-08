import type { ToolDefinition, ToolResult, JSONSchema } from '../../core/types';
import type {
  DelegationPattern,
  FanOutConfig,
  ChainConfig,
  RouterConfig,
} from '../../core/delegation/types';
import { logger } from '../../core/logger';

export interface ExtractedDelegateCall {
  pattern: DelegationPattern;
  config: FanOutConfig | ChainConfig | RouterConfig;
}

const VALID_PATTERNS: DelegationPattern[] = ['fan-out', 'chain', 'router'];

function isValidDelegateCall(obj: unknown): obj is { pattern: DelegationPattern; config: FanOutConfig | ChainConfig | RouterConfig } {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  if (!VALID_PATTERNS.includes(r['pattern'] as DelegationPattern)) return false;
  if (!r['config'] || typeof r['config'] !== 'object') return false;
  const cfg = r['config'] as Record<string, unknown>;
  if (Array.isArray(cfg['tasks']) && cfg['tasks'].length > 0) return true;
  if (Array.isArray(cfg['routes']) && cfg['routes'].length > 0) return true;
  return false;
}

function extractBalancedJson(text: string, startPos: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(startPos, i + 1);
    }
  }
  return null;
}

export function extractDelegateFromContent(content: string): ExtractedDelegateCall | null {
  const codeBlockRe = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      if (isValidDelegateCall(parsed)) {
        logger.info('tool', 'Extracted delegate call from content (code block)');
        return { pattern: parsed.pattern, config: parsed.config };
      }
    } catch { /* skip */ }
  }

  const patternKeyRe = /"pattern"\s*:\s*"(?:fan-out|chain|router)"/g;
  let patternMatch: RegExpExecArray | null;
  while ((patternMatch = patternKeyRe.exec(content)) !== null) {
    const jsonStart = content.lastIndexOf('{', patternMatch.index);
    if (jsonStart === -1) continue;
    const jsonStr = extractBalancedJson(content, jsonStart);
    if (!jsonStr) continue;
    try {
      const parsed = JSON.parse(jsonStr);
      if (isValidDelegateCall(parsed)) {
        logger.info('tool', 'Extracted delegate call from content (balanced JSON)');
        return { pattern: parsed.pattern, config: parsed.config };
      }
    } catch { /* skip */ }
  }

  return null;
}

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
      'Delegate tasks to specialized subagents. ' +
      'YOU MUST USE THIS TOOL for ALL tasks requiring file search, code analysis, or file reading. ' +
      'Subagent tools: bash, glob_search, content_search, rag_search, read_file, list_files. ' +
      'Patterns: fan-out (parallel), chain (sequential), router (conditional). ' +
      'Example: delegate({pattern:"fan-out",config:{tasks:[{description:"Find X",tools:["glob_search","content_search","read_file"]}]}})',
    parameters: createDelegateSchema(),
    execute,
  };
}
