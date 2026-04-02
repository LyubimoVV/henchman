import simpleGit from 'simple-git';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export function createGitBranchTool(projectPath: string): ToolDefinition {
  return {
    name: 'git_branch',
    category: 'mcp',
    description: 'Get the current git branch name',
    parameters: createSimpleToolSchema({}, []),
    execute: async (): Promise<ToolResult> => {
      try {
        const git = simpleGit(projectPath);
        const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

        return {
          success: true,
          result: {
            branch: branch.trim(),
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
