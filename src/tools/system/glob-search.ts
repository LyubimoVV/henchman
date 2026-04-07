import { glob } from 'glob';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export const globSearchTool: ToolDefinition = {
  name: 'glob_search',
  category: 'system',
  description:
    'Find files by glob pattern. Use for finding files by NAME (not content). ' +
    'FAST and EFFICIENT for locating specific files. ' +
    'Examples: ' +
    '  - glob_search({pattern: "**/*Client.java"}) - find all Java files ending with Client ' +
    '  - glob_search({pattern: "src/**/*Service.java"}) - find Service files in src/ ' +
    '  - glob_search({pattern: "**/*test*.ts"}) - find test files ' +
    'Use this INSTEAD of list_files when you know the file name pattern.',
  parameters: createSimpleToolSchema(
    {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match file paths (e.g., "**/*Client.java", "src/**/*.ts", "**/*test*.py")',
      },
      path: {
        type: 'string',
        description: 'Base directory to search in (default: current directory)',
      },
    },
    ['pattern']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const pattern = args['pattern'] as string;
    const basePath = (args['path'] as string) ?? '.';

    if (!pattern) {
      throw new Error('Pattern is required');
    }

    try {
      const files = await glob(pattern, {
        cwd: basePath,
        ignore: [
          'node_modules/**',
          'target/**',
          'dist/**',
          'build/**',
          'bin/**',
          '.git/**',
          '**/*.class',
          '**/*.jar',
          '**/*.log',
        ],
        nodir: true,
        absolute: false,
      });

      return {
        success: true,
        result: {
          pattern,
          basePath,
          files,
          count: files.length,
          truncated: files.length >= 100,
        },
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: `Glob search failed: ${(error as Error).message}`,
      };
    }
  },
};
