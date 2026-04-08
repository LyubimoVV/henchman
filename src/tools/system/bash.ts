import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { logger } from '../../core/logger';
import { getCurrentProjectPath } from './project-context';

const execAsync = promisify(exec);

const ALLOWED_COMMANDS = [
  'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail',
  'npm', 'node', 'npx', 'yarn', 'pnpm',
  'git', 'gh',
  'grep', 'find', 'rg', 'fd',
  'mkdir', 'touch',
];

const BLOCKED_COMMANDS = [
  'type', 'more', 'less', 'findstr', 'powershell', 'cmd', 'start',
  'del', 'rm', 'rmdir', 'copy', 'xcopy', 'move', 'ren', 'format',
  'mklink', 'net', 'reg', 'sc', 'taskkill', 'shutdown',
  'cd', 'chdir', 'set', 'setx', 'assoc', 'ftype', 'at', 'schtasks',
  'icacls', 'takeown', 'cipher', 'compact', 'convert', 'diskpart',
  'format', 'label', 'recover', 'replace', 'subst', 'tree',
];

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim();

  if (/[|&;`$]/.test(trimmed)) {
    logger.debug('tool', 'Command blocked: chain/pipe detected', { command: trimmed });
    return false;
  }

  if (/\b(cd|chdir)\b/i.test(trimmed)) {
    logger.debug('tool', 'Command blocked: cd detected', { command: trimmed });
    return false;
  }

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';

  if (BLOCKED_COMMANDS.includes(firstWord)) {
    logger.debug('tool', 'Command blocked: forbidden first word', { command: trimmed, firstWord });
    return false;
  }

  const allowed = ALLOWED_COMMANDS.includes(firstWord);
  if (!allowed) {
    logger.debug('tool', 'Command blocked: not in allowlist', { command: trimmed, firstWord });
  }
  return allowed;
}

function normalizeCommandPath(command: string): string {
  return command.replace(/\\/g, '/');
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  category: 'system',
  description:
    'Execute a shell command. Only safe commands are allowed (ls, git, npm, cat, head, tail, etc.). Use for file listing, git operations, reading files with cat/head. FORBIDDEN: type, cd, powershell, &&, |, ;. For reading files: bash {"command": "cat <path>"}',
  parameters: createSimpleToolSchema(
    {
      command: {
        type: 'string',
        description: 'The shell command to execute. Use forward slashes in paths. No chaining (no &&, |, ;). Single command only.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution (optional, defaults to project root)',
      },
    },
    ['command']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const rawCommand = args['command'] as string;
    const explicitCwd = args['cwd'] as string | undefined;

    if (!rawCommand) {
      throw new Error('Command is required');
    }

    const projectPath = getCurrentProjectPath();
    const command = normalizeCommandPath(rawCommand);

    const cwd = explicitCwd
      ? resolveSafeCwd(explicitCwd, projectPath)
      : projectPath ?? undefined;

    if (!isCommandAllowed(command)) {
      return {
        success: false,
        result: {
          stdout: '',
          stderr: `Command not allowed: ${rawCommand}. Allowed: ${ALLOWED_COMMANDS.join(', ')}. Blocked: type, cd, powershell, &&, |, ;. For reading files: bash {"command": "cat <path>"}`,
        },
        error: `Command not allowed: "${rawCommand}". Allowed: ${ALLOWED_COMMANDS.join(', ')}. For reading files: use bash {"command": "cat <file>"}`,
      };
    }

    logger.info('tool', 'Executing command', { command, cwd: cwd ?? 'default' });

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

function resolveSafeCwd(requested: string, projectPath: string | null): string | undefined {
  const normalized = requested.replace(/\\/g, '/');

  if (projectPath) {
    const normalizedProject = projectPath.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedProject) || normalized.startsWith('./')) {
      return normalized;
    }
    logger.warn('tool', 'Requested cwd outside project path, using project root', {
      requested: normalized,
      projectPath: normalizedProject,
    });
    return normalizedProject;
  }

  return normalized;
}
