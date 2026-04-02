import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { embedder } from '../../rag/embedder';

export const embedTool: ToolDefinition = {
  name: 'rag_embed',
  category: 'rag',
  description: 'Generate embeddings for a text using Ollama. Returns the embedding vector.',
  parameters: createSimpleToolSchema(
    {
      text: {
        type: 'string',
        description: 'Text to generate embeddings for',
      },
    },
    ['text']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const text = args['text'] as string;

    if (!text) {
      throw new Error('Text is required');
    }

    const embedding = await embedder.embed(text);

    return {
      success: true,
      result: {
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        embeddingDimensions: embedding.length,
        embedding: embedding,
      },
    };
  },
};
