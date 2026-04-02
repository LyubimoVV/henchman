export { bashTool } from './bash';
export { fileReadTool } from './file-read';
export { fileWriteTool } from './file-write';
export { findFilesTool } from './find-files';

import { bashTool } from './bash';
import { fileReadTool } from './file-read';
import { fileWriteTool } from './file-write';
import { findFilesTool } from './find-files';
import type { ToolDefinition } from '../../core/types';

export const systemTools: ToolDefinition[] = [
  bashTool,
  fileReadTool,
  fileWriteTool,
  findFilesTool,
];
