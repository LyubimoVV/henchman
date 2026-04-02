import { readFile, stat } from 'fs/promises';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { join, isAbsolute } from 'path';

export function createReadFileTool(projectPath: string): ToolDefinition {
  return {
    name: 'read_file',
    category: 'mcp',
    description:
      'Read the contents of a file from the project. Path is relative to project root.',
    parameters: createSimpleToolSchema(
      {
        path: {
          type: 'string',
          description: 'Path to the file (relative to project root)',
        },
        lines: {
          type: 'boolean',
          description: 'Add line numbers to output (default: true)',
        },
      },
      ['path']
    ),
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const relativePath = args['path'] as string;
      const showLines = (args['lines'] as boolean) ?? true;

      if (!relativePath) {
        throw new Error('File path is required');
      }

      const absolutePath = isAbsolute(relativePath)
        ? relativePath
        : join(projectPath, relativePath);

      try {
        const [content, stats] = await Promise.all([
          readFile(absolutePath, 'utf-8'),
          stat(absolutePath),
        ]);

        const lines = content.split('\n');
        const formattedContent = showLines
          ? lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
          : content;

        return {
          success: true,
          result: {
            path: relativePath,
            absolutePath,
            content: formattedContent,
            lines: lines.length,
            size: stats.size,
            projectPath,
          },
        };
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          throw new Error(`File not found: ${relativePath}`);
        }
        if (err.code === 'EACCES') {
          throw new Error(`Permission denied: ${relativePath}`);
        }
        throw error;
      }
    },
  };
}
