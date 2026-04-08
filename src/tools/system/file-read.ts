import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { getCurrentProjectPath } from './project-context';

export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  category: 'system',
  description:
    'Read the contents of a file from the filesystem. Returns the file content as a string.',
  parameters: createSimpleToolSchema(
    {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
      },
    },
    ['path']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    let filePath = args['path'] as string;
    const encoding = (args['encoding'] as BufferEncoding) ?? 'utf-8';

    if (!filePath) {
      throw new Error('File path is required');
    }

    const projectPath = getCurrentProjectPath();
    if (!isAbsolute(filePath) && projectPath) {
      filePath = join(projectPath, filePath);
    }

    try {
      const content = await readFile(filePath, encoding);
      return {
        success: true,
        result: {
          path: filePath,
          content,
          size: content.length,
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: ${filePath}`);
      }
      throw error;
    }
  },
};
