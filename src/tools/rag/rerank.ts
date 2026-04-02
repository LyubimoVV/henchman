import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { rerankClient } from '../../rag/rerank-client';

export const rerankTool: ToolDefinition = {
  name: 'rag_rerank',
  category: 'rag',
  description:
    'Rerank a list of documents based on relevance to a query. Uses external Python rerank service.',
  parameters: createSimpleToolSchema(
    {
      query: {
        type: 'string',
        description: 'Query to rank documents against',
      },
      documents: {
        type: 'string',
        description: 'JSON array of document strings to rerank',
      },
      topN: {
        type: 'number',
        description: 'Number of top results to return (default: 5)',
      },
    },
    ['query', 'documents']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const query = args['query'] as string;
    const documentsJson = args['documents'] as string;
    const topN = (args['topN'] as number) ?? 5;

    if (!query) {
      throw new Error('Query is required');
    }
    if (!documentsJson) {
      throw new Error('Documents are required');
    }

    let documents: string[];
    try {
      documents = JSON.parse(documentsJson) as string[];
    } catch {
      throw new Error('Documents must be a valid JSON array of strings');
    }

    if (!Array.isArray(documents)) {
      throw new Error('Documents must be an array');
    }

    const chunks = documents.map((doc, index) => ({
      id: `doc_${index}`,
      content: doc,
      filePath: 'inline',
      score: 0,
      metadata: { filePath: 'inline', startLine: 0, endLine: 0, chunkIndex: index },
    }));

    const results = await rerankClient.rerank(query, chunks, topN);

    return {
      success: true,
      result: {
        query,
        results: results.map((r, index) => ({
          rank: index + 1,
          score: r.score,
          content: r.content.substring(0, 300) + (r.content.length > 300 ? '...' : ''),
        })),
        total: results.length,
      },
    };
  },
};
