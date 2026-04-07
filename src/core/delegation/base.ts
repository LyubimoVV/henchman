import type { SubagentContext, ToolDefinition } from '../types';
import type { DelegationTask, DelegationResult, DelegationExecutorOptions } from './types';
import type { AgentInfo } from '../agent/types';
import { agentRegistry } from '../agent/registry';
import { isToolAllowed } from '../permission';
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
  'search': 'rag_search',
  'semantic_search': 'rag_search',
  'grep': 'content_search',
  'content_grep': 'content_search',
};

const BLOCKED_TOOLS = ['delegate', 'fan-out', 'chain', 'router'];

const DEFAULT_SUBAGENT_TOOLS = ['rag_search', 'content_search'];

export abstract class DelegationExecutor {
  protected options: DelegationExecutorOptions;
  protected subagentType: string;

  constructor(options: DelegationExecutorOptions, subagentType: string = 'general') {
    this.options = options;
    this.subagentType = subagentType;
  }

  abstract execute(config: unknown): Promise<DelegationResult[] | DelegationResult>;

  protected getAgentInfo(): AgentInfo {
    return agentRegistry.get(this.subagentType) ?? agentRegistry.get('general')!;
  }

  protected createSubagentContext(task: DelegationTask): SubagentContext {
    const baseContext: SubagentContext = {
      projectPath: this.options.projectPath,
      gitBranch: this.options.gitBranch,
      indexedFiles: this.options.indexedFiles,
      taskId: task.id,
      taskDescription: task.description,
      parentAgentId: 'delegation',
      allowedTools: task.tools,
      ...task.context,
    };

    if (task.sharedContext) {
      baseContext.sharedContext = {
        foundFiles: Array.from(task.sharedContext.foundFiles),
        searchCache: Object.fromEntries(task.sharedContext.searchCache),
      };
    }

    return baseContext;
  }

  protected resolveTools(toolNames: string[]): ToolDefinition[] {
    const agent = this.getAgentInfo();
    const tools: ToolDefinition[] = [];
    const notFound: string[] = [];
    const allToolNames = [...new Set([...DEFAULT_SUBAGENT_TOOLS, ...toolNames])];
    
    for (const name of allToolNames) {
      const resolvedName = TOOL_ALIASES[name] ?? name;
      
      if (BLOCKED_TOOLS.includes(resolvedName) || BLOCKED_TOOLS.includes(name)) {
        logger.warn('subagent', `Subagent task attempted to use blocked tool "${name}" - ignoring`);
        continue;
      }

      if (!isToolAllowed(agent, resolvedName)) {
        logger.warn('subagent', `Tool "${name}" denied by agent "${agent.name}" permissions`);
        continue;
      }
      
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

    if (tools.length === 0 && allToolNames.length > 0) {
      logger.warn('subagent', 'No tools available for subagent after resolution', {
        requested: allToolNames,
        notFound,
      });
    } else if (tools.length > 0) {
      logger.info('subagent', 'Subagent tools resolved', {
        requested: allToolNames,
        available: tools.map(t => t.name),
        notFound: notFound.length > 0 ? notFound : undefined,
      });
    }

    return tools;
  }

  protected async executeTask(task: DelegationTask): Promise<DelegationResult> {
    const tools = this.resolveTools(task.tools);
    const context = this.createSubagentContext(task);
    const agent = this.getAgentInfo();
    const subagent = createSubagent(task.description, tools, context, { agent });

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
