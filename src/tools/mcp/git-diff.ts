import simpleGit from 'simple-git';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export function createGitDiffTool(projectPath: string): ToolDefinition {
  return {
    name: 'git_diff',
    category: 'mcp',
    description:
      'Get git diff output. Shows changes between working directory and index, or between commits.',
    parameters: createSimpleToolSchema(
      {
        staged: {
          type: 'boolean',
          description: 'Show staged changes (--cached)',
        },
        file: {
          type: 'string',
          description: 'Specific file to show diff for (optional)',
        },
      },
      []
    ),
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const staged = args['staged'] as boolean;
      const file = args['file'] as string | undefined;

      try {
        const git = simpleGit(projectPath);
        let diff: string;

        if (staged) {
          diff = file
            ? await git.diff(['--cached', file])
            : await git.diff(['--cached']);
        } else {
          diff = file ? await git.diff([file]) : await git.diff();
        }

        return {
          success: true,
          result: {
            diff: diff || 'No changes',
            staged: staged ?? false,
            file: file ?? null,
            projectPath,
          },
        };
      } catch (error) {
        const err = error as Error;
        if (err.message.includes('not a git repository')) {
          throw new Error('Not a git repository');
        }
        throw error;
      }
    },
  };
}
