import { glob } from 'glob';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export const findFilesTool: ToolDefinition = {
  name: 'find_files',
  category: 'system',
  description:
    'Find files matching a glob pattern. Returns a list of file paths relative to the search directory.',
  parameters: createSimpleToolSchema(
    {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")',
      },
      cwd: {
        type: 'string',
        description: 'Base directory to search from (default: current directory)',
      },
      ignore: {
        type: 'string',
        description: 'Comma-separated glob patterns to ignore (e.g., "node_modules,**/*.test.ts")',
      },
    },
    ['pattern']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const pattern = args['pattern'] as string;
    const cwd = (args['cwd'] as string) ?? process.cwd();
    const ignoreStr = args['ignore'] as string | undefined;

    if (!pattern) {
      throw new Error('Pattern is required');
    }

    const ignore = ignoreStr
      ? ignoreStr.split(',').map((s) => s.trim())
      : ['node_modules/**', 'dist/**', '.git/**'];

    try {
      const files = await glob(pattern, {
        cwd,
        ignore,
        nodir: true,
        absolute: false,
      });

      return {
        success: true,
        result: {
          pattern,
          cwd,
          files,
          count: files.length,
        },
      };
    } catch (error) {
      throw new Error(`Failed to find files: ${(error as Error).message}`);
    }
  },
};
