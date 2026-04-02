import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';

export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  category: 'system',
  description:
    'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories if needed.',
  parameters: createSimpleToolSchema(
    {
      path: {
        type: 'string',
        description: 'Path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
      },
    },
    ['path', 'content']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const path = args['path'] as string;
    const content = args['content'] as string;
    const encoding = (args['encoding'] as BufferEncoding) ?? 'utf-8';

    if (!path) {
      throw new Error('File path is required');
    }
    if (content === undefined || content === null) {
      throw new Error('Content is required');
    }

    try {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, content, encoding);

      return {
        success: true,
        result: {
          path,
          size: content.length,
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: ${path}`);
      }
      throw error;
    }
  },
};
