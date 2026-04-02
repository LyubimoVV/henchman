import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { retriever } from '../../rag/retriever';

export const searchTool: ToolDefinition = {
  name: 'rag_search',
  category: 'rag',
  description:
    'Search for relevant chunks in the indexed project documentation using semantic search. Returns relevant text chunks with scores.',
  parameters: createSimpleToolSchema(
    {
      query: {
        type: 'string',
        description: 'Search query',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 5)',
      },
    },
    ['query']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const query = args['query'] as string;
    const topK = (args['topK'] as number) ?? 5;

    if (!query) {
      throw new Error('Query is required');
    }

    const results = await retriever.search(query, { rerankTopN: topK });

    return {
      success: true,
      result: {
        query,
        results: results.map((r) => ({
          filePath: r.filePath,
          score: r.score,
          content: r.content.substring(0, 500) + (r.content.length > 500 ? '...' : ''),
          lines: `${r.metadata.startLine}-${r.metadata.endLine}`,
        })),
        total: results.length,
      },
    };
  },
};
