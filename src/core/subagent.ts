import type {
  SubagentTask,
  SubagentResult,
  SubagentContext,
  ChatMessage,
  ToolDefinition,
} from './types';
import { toolUseLoop } from './tool-use-loop';
import { logger } from './logger';

function generateId(): string {
  return `subagent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class Subagent {
  private task: SubagentTask;
  private logs: string[];
  private foundFiles: Set<string>;
  private searchCache: Map<string, unknown>;

  constructor(task: SubagentTask) {
    this.task = task;
    this.logs = [];
    this.foundFiles = new Set();
    this.searchCache = new Map();
  }

  async execute(): Promise<SubagentResult> {
    logger.subagentSpawn(this.task.id, this.task.description);

    if (this.task.tools.length === 0) {
      logger.warn('subagent', 'Subagent has no tools available', { taskId: this.task.id });
    } else {
      logger.info('subagent', 'Subagent tools available', {
        taskId: this.task.id,
        tools: this.task.tools.map(t => t.name),
      });
    }

    try {
      const systemPrompt = this.buildSystemPrompt();
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.task.description },
      ];

      const result = await toolUseLoop(messages, {
        maxIterations: 15,
        tools: this.task.tools,
        onToolCall: (name, args) => {
          this.logs.push(`Tool call: ${name}(${JSON.stringify(args)})`);
        },
        onToolResult: (name, result, success) => {
          this.logs.push(`Tool result: ${name} - ${success ? 'success' : 'failed'}`);
          this.trackFoundFiles(name, result, success);
        },
      });

      logger.subagentComplete(this.task.id, 'success');

      return {
        taskId: this.task.id,
        status: 'success',
        data: result.finalContent,
        filesModified: this.extractModifiedFiles(result.messages),
        logs: this.logs,
        contextOut: {
          lastQuery: this.task.description,
          sharedContext: {
            foundFiles: Array.from(this.foundFiles),
            searchCache: Object.fromEntries(this.searchCache),
          },
        },
      };
    } catch (error) {
      logger.subagentComplete(this.task.id, 'error');

      return {
        taskId: this.task.id,
        status: 'error',
        data: null,
        filesModified: [],
        logs: [...this.logs, `Error: ${(error as Error).message}`],
        contextOut: {},
      };
    }
  }

  private buildSystemPrompt(): string {
    const toolNames = this.task.tools.map((t) => t.name).join(', ');
    const hasRagSearch = this.task.tools.some(t => t.name === 'rag_search');
    const hasContentSearch = this.task.tools.some(t => t.name === 'content_search');
    
    const searchHints: string[] = [];
    if (hasRagSearch || hasContentSearch) {
      searchHints.push('## Search Tools (USE THESE FIRST):');
      if (hasContentSearch) {
        searchHints.push(
          '- content_search: FAST exact text/regex search in file contents (like grep).',
          '  - Use for finding specific code, component names, function definitions.',
          '  - ALWAYS use ignoreCase=true for case-insensitive search.',
          '  - Use ONE search with ignoreCase=true instead of multiple case-sensitive searches.',
          '  - Example: content_search({pattern: "UserService", ignoreCase: true, maxResults: 100})',
        );
      }
      if (hasRagSearch) {
        searchHints.push(
          '- rag_search: Semantic search in indexed project files.',
          '  - Use for conceptual searches ("authentication flow", "error handling").',
          '  - Slower than content_search (involves reranking).',
          '  - Returns semantically relevant code even if exact words differ.',
          '  - Describe WHAT code does, not exact text.',
          '  - Example: rag_search({query: "DeepSeekClient API client implementation"})',
          '  - Example: rag_search({query: "database connection pooling logic"})',
        );
      }
      searchHints.push(
        '',
        '## Search Strategy:',
        '1. Start with content_search (fastest) for exact names/patterns',
        '2. Use rag_search for semantic/conceptual queries or when content_search fails',
        '3. Read files only after search narrows down results',
         '4. AVOID redundant searches - one good search is better than many weak ones',
        '',
        '## Task Completion:',
        '- STOP immediately when you have found the requested information',
        '- REPORT your findings clearly: file paths, line numbers, relevant code',
        '- Do NOT continue searching if task is already complete',
        '- If asked to find a class/function/component, provide its location and stop',
        '- Avoid unnecessary iterations - 2-3 successful tool calls should be enough',
      );
    }

    return [
      'You are a specialized subagent working on a specific task.',
      '',
      `## Available Tools: ${toolNames}`,
      '',
      '## Restrictions:',
      '- You do NOT have access to delegation tools (delegate, fan-out, chain, router).',
      '- You CANNOT create subagents or delegate tasks.',
      '- Use only the tools explicitly listed above.',
      '',
      '## Context:',
      `- Project Path: ${this.task.contextIn.projectPath}`,
      this.task.contextIn.gitBranch ? `- Git Branch: ${this.task.contextIn.gitBranch}` : '',
      '',
      ...searchHints,
      '',
      '## Instructions:',
      '- START with search tools (content_search or rag_search) to locate relevant code.',
      '- Use content_search with ignoreCase=true for comprehensive results.',
      '- AVOID multiple similar searches - combine parameters when possible.',
      '- Read files only AFTER you have identified relevant locations.',
      '- Be concise and focused on the specific task.',
      '- Report your findings clearly with file paths and line references.',
      '- If you cannot complete the task, explain why.',
      '- Do NOT attempt to use tools that are not available.',
      '- Do NOT exceed 10 tool calls - optimize your search strategy.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private trackFoundFiles(toolName: string, result: unknown, success: boolean): void {
    if (!success || !result) return;

    try {
      if (toolName === 'list_files') {
        const res = result as { files?: unknown; result?: { files?: unknown } };
        const files = res.files ?? res.result?.files;
        if (Array.isArray(files)) {
          files.forEach((f: unknown) => {
            if (typeof f === 'string') this.foundFiles.add(f);
          });
        }
      }
      
      if (toolName === 'content_search') {
        const res = result as { results?: unknown; result?: { results?: unknown } };
        const results = res.results ?? res.result?.results;
        if (Array.isArray(results)) {
          results.forEach((r: unknown) => {
            if (r && typeof r === 'object' && 'file' in r) {
              const file = (r as { file: unknown }).file;
              if (typeof file === 'string') this.foundFiles.add(file);
            }
          });
        }
      }
      
      if (toolName === 'read_file') {
        const res = result as { path?: unknown; result?: { path?: unknown } };
        const path = res.path ?? res.result?.path;
        if (typeof path === 'string') {
          this.foundFiles.add(path);
        }
      }
    } catch {
      // Silently ignore tracking errors
    }
  }

  private extractModifiedFiles(messages: ChatMessage[]): string[] {
    const files: Set<string> = new Set();

    for (const message of messages) {
      if (message.role === 'tool' && message.content) {
        try {
          const content = JSON.parse(message.content) as { path?: string; filePath?: string };
          if (content.path) files.add(content.path);
          if (content.filePath) files.add(content.filePath);
        } catch {
          // Not JSON, skip
        }
      }
    }

    return Array.from(files);
  }
}

export function createSubagent(
  description: string,
  tools: ToolDefinition[],
  context: SubagentContext
): Subagent {
  const task: SubagentTask = {
    id: generateId(),
    description,
    tools,
    contextIn: context,
  };

  return new Subagent(task);
}
