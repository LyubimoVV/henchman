export { embedTool } from './embed';
export { searchTool } from './search';
export { rerankTool } from './rerank';
export { indexProjectTool, getIndexPathsTool, setCurrentProjectPath, getCurrentProjectPath } from './index-project';

import { embedTool } from './embed';
import { searchTool } from './search';
import { rerankTool } from './rerank';
import { indexProjectTool, getIndexPathsTool } from './index-project';
import type { ToolDefinition } from '../../core/types';

export const ragTools: ToolDefinition[] = [
  embedTool,
  searchTool,
  rerankTool,
  indexProjectTool,
  getIndexPathsTool,
];
