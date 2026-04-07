import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { retriever } from '../../rag/retriever';

export const searchTool: ToolDefinition = {
  name: 'rag_search',
  category: 'rag',
  description:
    'Semantic search in indexed project documentation using vector embeddings and reranking. ' +
    'Use for CONCEPTUAL and CONTEXTUAL queries, NOT exact text matches. ' +
    'RECOMMENDED for finding classes, functions, or components by description or purpose. ' +
    'Examples: ' +
    '  - Find authentication code: rag_search({query: "authentication flow and user validation"}) ' +
    '  - Find API client: rag_search({query: "API client implementation for external services"}) ' +
    '  - Find error handling: rag_search({query: "error handling and exception management"}) ' +
    '  - Find specific class: rag_search({query: "DeepSeekClient class implementation"}) ' +
    '  - Find database code: rag_search({query: "database connection and query execution"}) ' +
    'Returns: filePath, content snippet (up to 500 chars), relevance score (0-1), line numbers. ' +
    'SLOWER than content_search but provides semantic understanding. ' +
    'Use rag_search when you want to understand WHAT code does, not just WHERE it is.',
  parameters: createSimpleToolSchema(
    {
      query: {
        type: 'string',
        description: 'Semantic search query describing WHAT you want to find (not exact code). ' +
          'Describe the concept, purpose, or functionality. ' +
          'Examples: "authentication flow", "API client implementation", "error handling patterns", ' +
          '"DeepSeekClient class", "database connection pooling"',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 20)',
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
