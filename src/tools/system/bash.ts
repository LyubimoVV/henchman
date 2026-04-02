import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

const execAsync = promisify(exec);

const ALLOWED_COMMANDS = [
  'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail',
  'npm', 'node', 'npx', 'yarn', 'pnpm',
  'git', 'gh',
  'grep', 'find', 'rg', 'fd',
  'mkdir', 'touch',
];

function isCommandAllowed(command: string): boolean {
  const baseCommand = command.trim().split(/\s+/)[0] ?? '';
  return ALLOWED_COMMANDS.includes(baseCommand);
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  category: 'system',
  description:
    'Execute a shell command. Only safe commands are allowed (ls, git, npm, etc.). Use for file listing, git operations, package management.',
  parameters: createSimpleToolSchema(
    {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution (optional)',
      },
    },
    ['command']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const command = args['command'] as string;
    const cwd = args['cwd'] as string | undefined;

    if (!command) {
      throw new Error('Command is required');
    }

    if (!isCommandAllowed(command)) {
      throw new Error(`Command not allowed: ${command}. Allowed commands: ${ALLOWED_COMMANDS.join(', ')}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 1024 * 1024,
        timeout: 30000,
      });

      return {
        success: true,
        result: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        },
      };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string };
      return {
        success: false,
        result: {
          stdout: err.stdout?.trim() ?? '',
          stderr: err.stderr?.trim() ?? err.message,
        },
        error: err.message,
      };
    }
  },
};
