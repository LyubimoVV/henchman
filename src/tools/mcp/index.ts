export { createGitBranchTool } from './git-branch';
export { createGitDiffTool } from './git-diff';
export { createListFilesTool } from './list-files';
export { createReadFileTool } from './read-file';
export { getTicketTool } from './get-ticket';
export { getUserTool } from './get-user';
export { listTicketsTool } from './list-tickets';

import { createGitBranchTool } from './git-branch';
import { createGitDiffTool } from './git-diff';
import { createListFilesTool } from './list-files';
import { createReadFileTool } from './read-file';
import { getTicketTool } from './get-ticket';
import { getUserTool } from './get-user';
import { listTicketsTool } from './list-tickets';
import type { ToolDefinition } from '../../core/types';

export function createMcpTools(projectPath: string): ToolDefinition[] {
  return [
    createGitBranchTool(projectPath),
    createGitDiffTool(projectPath),
    createListFilesTool(projectPath),
    createReadFileTool(projectPath),
    getTicketTool,
    getUserTool,
    listTicketsTool,
  ];
}
