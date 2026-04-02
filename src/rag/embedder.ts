import { appConfig } from '../config';
import { logger } from '../core/logger';
import type { ChunkMetadata } from '../core/types';

export interface EmbeddingResult {
  embedding: number[];
  chunkId: string;
  metadata: ChunkMetadata;
}

class Embedder {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = appConfig.ollama.baseUrl;
    this.model = appConfig.ollama.embedModel;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[], batchSize: number = 10): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map((text) => this.embed(text)));
      results.push(...embeddings);

      logger.ragOperation('Embedding batch', {
        batch: Math.floor(i / batchSize) + 1,
        size: batch.length,
      });
    }

    return results;
  }

  async embedChunks(
    chunks: { id: string; content: string; metadata: ChunkMetadata }[]
  ): Promise<EmbeddingResult[]> {
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embedBatch(texts);

    return chunks.map((chunk, i) => ({
      embedding: embeddings[i]!,
      chunkId: chunk.id,
      metadata: chunk.metadata,
    }));
  }
}

export const embedder = new Embedder();
export { Embedder };
