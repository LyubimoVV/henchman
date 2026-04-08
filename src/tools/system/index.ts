export { bashTool } from './bash';
export { fileReadTool } from './file-read';
export { fileWriteTool } from './file-write';
export { findFilesTool } from './find-files';
export { contentSearchTool } from './content-search';
export { globSearchTool } from './glob-search';
export { searchAggregatorTool } from './search-aggregator';
export { createDelegateTool } from './delegate';
export { createQuestionTool } from './question';
export { setCurrentProjectPath, getCurrentProjectPath } from './project-context';

import { bashTool } from './bash';
import { fileReadTool } from './file-read';
import { fileWriteTool } from './file-write';
import { findFilesTool } from './find-files';
import { contentSearchTool } from './content-search';
import { globSearchTool } from './glob-search';
import { searchAggregatorTool } from './search-aggregator';
import type { ToolDefinition } from '../../core/types';

export const systemTools: ToolDefinition[] = [
  bashTool,
  fileReadTool,
  fileWriteTool,
  findFilesTool,
  contentSearchTool,
  globSearchTool,
  searchAggregatorTool,
];
