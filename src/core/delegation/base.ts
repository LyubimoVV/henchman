import type { SubagentContext, ToolDefinition } from '../types';
import type { DelegationTask, DelegationResult, DelegationExecutorOptions } from './types';
import { createSubagent } from '../subagent';
import { logger } from '../logger';

const TOOL_ALIASES: Record<string, string> = {
  'execute_command': 'bash',
  'shell': 'bash',
  'cmd': 'bash',
  'run_command': 'bash',
  'cat': 'file_read',
  'read': 'read_file',
  'ls': 'list_files',
  'list': 'list_files',
  'write_file': 'file_write',
  'find': 'find_files',
  'search_files': 'find_files',
  'current_branch': 'git_branch',
};

export abstract class DelegationExecutor {
  protected options: DelegationExecutorOptions;

  constructor(options: DelegationExecutorOptions) {
    this.options = options;
  }

  abstract execute(config: unknown): Promise<DelegationResult[] | DelegationResult>;

  protected createSubagentContext(task: DelegationTask): SubagentContext {
    return {
      projectPath: this.options.projectPath,
      gitBranch: this.options.gitBranch,
      indexedFiles: this.options.indexedFiles,
      taskId: task.id,
      taskDescription: task.description,
      parentAgentId: 'delegation',
      allowedTools: task.tools,
      ...task.context,
    };
  }

  protected resolveTools(toolNames: string[]): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    const notFound: string[] = [];
    
    for (const name of toolNames) {
      if (name === 'delegate') {
        logger.warn('subagent', 'Subagent task attempted to use delegate tool - ignoring');
        continue;
      }
      const resolvedName = TOOL_ALIASES[name] ?? name;
      const tool = this.options.subagentTools.find((t) => t.name === resolvedName);
      if (tool) {
        if (resolvedName !== name) {
          logger.debug('subagent', `Tool alias resolved: "${name}" -> "${resolvedName}"`);
        }
        tools.push(tool);
      } else {
        notFound.push(name);
        logger.warn('subagent', `Tool "${name}" not found in subagent tools, skipping`);
      }
    }

    if (tools.length === 0 && toolNames.length > 0) {
      logger.warn('subagent', 'No tools available for subagent after resolution', {
        requested: toolNames,
        notFound,
      });
    } else if (tools.length > 0) {
      logger.info('subagent', 'Subagent tools resolved', {
        requested: toolNames,
        available: tools.map(t => t.name),
        notFound: notFound.length > 0 ? notFound : undefined,
      });
    }

    return tools;
  }

  protected async executeTask(task: DelegationTask): Promise<DelegationResult> {
    const tools = this.resolveTools(task.tools);
    const context = this.createSubagentContext(task);
    const subagent = createSubagent(task.description, tools, context);

    try {
      const result = await subagent.execute();
      return {
        taskId: task.id,
        status: result.status,
        data: result.data,
        contextOut: result.contextOut,
        logs: result.logs,
      };
    } catch (error) {
      return {
        taskId: task.id,
        status: 'error',
        data: null,
        contextOut: {},
        logs: [`Error: ${(error as Error).message}`],
      };
    }
  }

  protected generateTaskId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
