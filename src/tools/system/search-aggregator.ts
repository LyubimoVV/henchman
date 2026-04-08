import { exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { getCurrentProjectPath } from './project-context';
import { logger } from '../../core/logger';

const execAsync = promisify(exec);

interface AggregatedResult {
  files: string[];
  total: number;
  bySource: {
    glob: string[];
    content: string[];
  };
}

export const searchAggregatorTool: ToolDefinition = {
  name: 'search_aggregate',
  category: 'system',
  description:
    'Aggregate search results from glob_search and content_search in one call. ' +
    'Returns deduplicated file list. Use for broad searches like "find all test files" or "find all files mentioning X". ' +
    'More efficient than calling multiple search tools separately.',
  parameters: createSimpleToolSchema(
    {
      globPattern: {
        type: 'string',
        description: 'Glob pattern for file name matching (e.g., "**/*test*.ts", "**/*Service.java")',
      },
      contentPattern: {
        type: 'string',
        description: 'Regex pattern to search in file contents (e.g., "@test", "describe\\(")',
      },
      fileTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'File extensions to filter (e.g., ["ts", "js", "java"])',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum files to return (default: 100)',
      },
    },
    [],
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const globPattern = args['globPattern'] as string | undefined;
    const contentPattern = args['contentPattern'] as string | undefined;
    const fileTypes = args['fileTypes'] as string[] | undefined;
    const maxResults = (args['maxResults'] as number) ?? 100;
    const basePath = getCurrentProjectPath() ?? '.';

    if (!globPattern && !contentPattern) {
      return {
        success: false,
        result: null,
        error: 'At least one of globPattern or contentPattern is required',
      };
    }

    const globFiles = new Set<string>();
    const contentFiles = new Set<string>();

    if (globPattern) {
      try {
        const files = await glob(globPattern, {
          cwd: basePath,
          ignore: ['node_modules/**', 'target/**', 'dist/**', 'build/**', 'bin/**', '.git/**'],
          nodir: true,
          absolute: false,
        });
        files.forEach(f => globFiles.add(f));
      } catch (error) {
        logger.debug('tool', 'Glob search failed in aggregator', { error: (error as Error).message });
      }
    }

    if (contentPattern) {
      try {
        let command = `rg -l --no-heading`;
        if (fileTypes && fileTypes.length > 0) {
          fileTypes.forEach(ft => { command += ` -t ${ft}`; });
        }
        command += ` --glob "!{node_modules,dist,.git,target,bin}/**"`;
        command += ` -m ${maxResults}`;
        command += ` "${contentPattern.replace(/"/g, '\\"')}"`;
        command += ` ${basePath}`;

        const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024, timeout: 30000 });
        stdout.split('\n').filter(Boolean).forEach(f => contentFiles.add(f));
      } catch {
        try {
          let command = `grep -rl`;
          if (fileTypes && fileTypes.length > 0) {
            fileTypes.forEach(ft => { command += ` --include="*.${ft}"`; });
          }
          command += ` --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=target`;
          command += ` "${contentPattern.replace(/"/g, '\\"')}"`;
          command += ` ${basePath}`;

          const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024, timeout: 30000 });
          stdout.split('\n').filter(Boolean).forEach(f => contentFiles.add(f));
        } catch {
          logger.debug('tool', 'Content search failed in aggregator');
        }
      }
    }

    const allFiles = new Set([...globFiles, ...contentFiles]);
    const sorted = Array.from(allFiles).sort().slice(0, maxResults);

    const result: AggregatedResult = {
      files: sorted,
      total: sorted.length,
      bySource: {
        glob: Array.from(globFiles),
        content: Array.from(contentFiles),
      },
    };

    return {
      success: true,
      result,
    };
  },
};
