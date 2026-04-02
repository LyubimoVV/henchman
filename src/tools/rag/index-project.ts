import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { indexer } from '../../rag/indexer';
import { vectorStore } from '../../rag/vector-store';

let currentProjectPath: string | null = null;

export function setCurrentProjectPath(path: string): void {
  currentProjectPath = path;
}

export function getCurrentProjectPath(): string | null {
  return currentProjectPath;
}

export const indexProjectTool: ToolDefinition = {
  name: 'rag_index_project',
  category: 'rag',
  description:
    'Index the project documentation (README, docs/, config files) for semantic search. Call this before using rag_search.',
  parameters: createSimpleToolSchema(
    {
      projectPath: {
        type: 'string',
        description: 'Path to the project to index (optional, uses current project if not specified)',
      },
    },
    []
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const projectPath = (args['projectPath'] as string) ?? currentProjectPath;

    if (!projectPath) {
      throw new Error('Project path is required. Specify projectPath or set a current project.');
    }

    const result = await indexer.indexProject(projectPath);
    const stats = vectorStore.stats();

    return {
      success: true,
      result: {
        projectPath,
        filesProcessed: result.filesProcessed,
        chunksCreated: result.chunksCreated,
        totalChunks: stats.totalChunks,
        totalFiles: stats.totalFiles,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    };
  },
};

export const getIndexPathsTool: ToolDefinition = {
  name: 'rag_get_indexed_files',
  category: 'rag',
  description: 'Get list of files that have been indexed in the vector store.',
  parameters: createSimpleToolSchema({}, []),
  execute: async (): Promise<ToolResult> => {
    const files = vectorStore.getIndexedFiles();
    const stats = vectorStore.stats();

    return {
      success: true,
      result: {
        files,
        totalFiles: stats.totalFiles,
        totalChunks: stats.totalChunks,
      },
    };
  },
};
