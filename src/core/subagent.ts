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

  constructor(task: SubagentTask) {
    this.task = task;
    this.logs = [];
  }

  async execute(): Promise<SubagentResult> {
    logger.subagentSpawn(this.task.id, this.task.description);

    try {
      const systemPrompt = this.buildSystemPrompt();
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.task.description },
      ];

      const result = await toolUseLoop(messages, {
        maxIterations: 10,
        tools: this.task.tools,
        onToolCall: (name, args) => {
          this.logs.push(`Tool call: ${name}(${JSON.stringify(args)})`);
        },
        onToolResult: (name, _result, success) => {
          this.logs.push(`Tool result: ${name} - ${success ? 'success' : 'failed'}`);
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

    return [
      'You are a specialized subagent working on a specific task.',
      '',
      `## Available Tools: ${toolNames}`,
      '',
      '## Context:',
      `- Project Path: ${this.task.contextIn.projectPath}`,
      this.task.contextIn.gitBranch ? `- Git Branch: ${this.task.contextIn.gitBranch}` : '',
      '',
      '## Instructions:',
      '- Use the available tools to complete the task.',
      '- Be concise and focused on the specific task.',
      '- Report your findings clearly.',
      '- If you cannot complete the task, explain why.',
    ]
      .filter(Boolean)
      .join('\n');
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
