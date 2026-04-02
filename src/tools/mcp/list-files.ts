import { glob } from 'glob';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export function createListFilesTool(projectPath: string): ToolDefinition {
  return {
    name: 'list_files',
    category: 'mcp',
    description:
      'List files in the project directory matching a pattern. Useful for exploring project structure.',
    parameters: createSimpleToolSchema(
      {
        pattern: {
          type: 'string',
          description: 'Glob pattern (default: "**/*")',
        },
        extension: {
          type: 'string',
          description: 'Filter by file extension (e.g., "ts", "java")',
        },
      },
      []
    ),
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const pattern = (args['pattern'] as string) ?? '**/*';
      const extension = args['extension'] as string | undefined;

      const finalPattern = extension
        ? pattern.replace(/\*$/, `*.${extension}`)
        : pattern;

      try {
        const files = await glob(finalPattern, {
          cwd: projectPath,
          ignore: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '.git/**',
            'target/**',
            '**/*.class',
            '**/*.jar',
          ],
          nodir: true,
        });

        return {
          success: true,
          result: {
            files: files.slice(0, 100),
            total: files.length,
            truncated: files.length > 100,
            projectPath,
          },
        };
      } catch (error) {
        throw new Error(`Failed to list files: ${(error as Error).message}`);
      }
    },
  };
}
