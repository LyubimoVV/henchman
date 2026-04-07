import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

const execAsync = promisify(exec);

export const contentSearchTool: ToolDefinition = {
  name: 'content_search',
  category: 'system',
  description:
    'Search for text patterns in file contents. Returns matching files with line numbers and context. ' +
    'IMPORTANT: Use this for searching CODE CONTENT, not file names or extensions. ' +
    'For file extension filtering, use fileTypes parameter. ' +
    'Examples: ' +
    '  - Find Java class: content_search({pattern: "class UserService", fileTypes: ["java"], ignoreCase: true}) ' +
    '  - Find function: content_search({pattern: "def authenticate", fileTypes: ["py"]}) ' +
    '  - Find component: content_search({pattern: "Button", fileTypes: ["tsx"], ignoreCase: true}) ' +
    '  - Find interface: content_search({pattern: "interface AuthService", fileTypes: ["ts"]}) ' +
    'DO NOT use this to search for file extensions like "\\.java$" - use fileTypes instead.',
  parameters: createSimpleToolSchema(
    {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search in file contents (REQUIRED parameter). Use for finding class names, function names, code patterns. Examples: "class UserService", "def authenticate", "interface.*Client"',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in (default: current directory)',
      },
      fileType: {
        type: 'string',
        description: 'Single file extension filter (e.g., "java", "ts", "py")',
      },
      fileTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple file extensions to search (e.g., ["java", "kt"]) - more efficient than multiple searches',
      },
      ignoreCase: {
        type: 'boolean',
        description: 'Case insensitive search (default: false) - RECOMMENDED for most searches',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50)',
      },
    },
    ['pattern']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const pattern = args['pattern'] as string;
    const path = (args['path'] as string) ?? '.';
    const fileType = args['fileType'] as string | undefined;
    const fileTypes = args['fileTypes'] as string[] | undefined;
    const ignoreCase = (args['ignoreCase'] as boolean) ?? false;
    const maxResults = (args['maxResults'] as number) ?? 50;

    if (!pattern) {
      throw new Error('Pattern is required');
    }

    if (fileType && fileTypes) {
      throw new Error('Cannot use both fileType and fileTypes parameters. Use fileTypes for multiple extensions.');
    }

    const escapedPattern = pattern.replace(/"/g, '\\"');
    
    let command: string;
    const hasRg = await checkCommand('rg --version');
    
    if (hasRg) {
      command = buildRipgrepCommand(escapedPattern, path, fileType, fileTypes, ignoreCase, maxResults);
    } else {
      command = buildGrepCommand(escapedPattern, path, fileType, fileTypes, ignoreCase, maxResults);
    }

    try {
      const { stdout } = await execAsync(command, {
        maxBuffer: 1024 * 1024,
        cwd: process.cwd(),
      });

      const results = parseResults(stdout, maxResults);

      return {
        success: true,
        result: {
          pattern,
          path,
          results,
          total: results.length,
          truncated: results.length >= maxResults,
        },
      };
    } catch (error) {
      const err = error as { stdout?: string; message?: string };
      if (err.stdout !== undefined) {
        const results = parseResults(err.stdout, maxResults);
        if (results.length > 0) {
          return {
            success: true,
            result: {
              pattern,
              path,
              results,
              total: results.length,
              truncated: results.length >= maxResults,
            },
          };
        }
      }
      return {
        success: true,
        result: {
          pattern,
          path,
          results: [],
          total: 0,
          message: 'No matches found',
        },
      };
    }
  },
};

async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await execAsync(cmd, { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

function buildRipgrepCommand(
  pattern: string,
  path: string,
  fileType?: string,
  fileTypes?: string[],
  ignoreCase?: boolean,
  maxResults?: number
): string {
  const parts = ['rg', '--no-heading', '--line-number'];
  
  if (ignoreCase) parts.push('-i');
  
  if (fileTypes && fileTypes.length > 0) {
    fileTypes.forEach(ft => parts.push('-t', ft));
  } else if (fileType) {
    parts.push('-t', fileType);
  }
  
  if (maxResults) parts.push('-m', String(maxResults));
  
  parts.push('--glob', '!{node_modules,dist,.git,target,bin}/**');
  parts.push('-e', `"${pattern}"`);
  parts.push(path);
  
  return parts.join(' ');
}

function buildGrepCommand(
  pattern: string,
  path: string,
  fileType?: string,
  fileTypes?: string[],
  ignoreCase?: boolean,
  maxResults?: number
): string {
  const parts = ['grep', '-rn'];
  
  if (ignoreCase) parts.push('-i');
  if (maxResults) parts.push('-m', String(maxResults));
  
  parts.push('--exclude-dir=node_modules');
  parts.push('--exclude-dir=dist');
  parts.push('--exclude-dir=.git');
  parts.push('--exclude-dir=target');
  parts.push('--exclude-dir=bin');
  
  if (fileTypes && fileTypes.length > 0) {
    fileTypes.forEach(ft => parts.push('--include', `*.${ft}`));
  } else if (fileType) {
    parts.push('--include', `*.${fileType}`);
  }
  
  parts.push('-E', `"${pattern}"`);
  parts.push(path);
  
  return parts.join(' ');
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

function parseResults(output: string, maxResults: number): SearchResult[] {
  const lines = output.split('\n').filter(Boolean);
  const results: SearchResult[] = [];

  for (const line of lines.slice(0, maxResults)) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match && match[1] && match[2] && match[3] !== undefined) {
      results.push({
        file: match[1],
        line: parseInt(match[2], 10),
        content: match[3].trim(),
        match: match[3].trim(),
      });
    }
  }

  return results;
}
