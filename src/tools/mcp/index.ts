export { createGitBranchTool } from './git-branch';
export { createGitDiffTool } from './git-diff';
export { createListFilesTool } from './list-files';
export { createReadFileTool } from './read-file';

import { createGitBranchTool } from './git-branch';
import { createGitDiffTool } from './git-diff';
import { createListFilesTool } from './list-files';
import { createReadFileTool } from './read-file';
import type { ToolDefinition } from '../../core/types';

export function createMcpTools(projectPath: string): ToolDefinition[] {
  return [
    createGitBranchTool(projectPath),
    createGitDiffTool(projectPath),
    createListFilesTool(projectPath),
    createReadFileTool(projectPath),
  ];
}
