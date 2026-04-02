import type { EmbeddingVector, RetrievedChunk, ChunkMetadata } from '../core/types';
import { logger } from '../core/logger';

class VectorStore {
  private vectors: Map<string, EmbeddingVector> = new Map();
  private indexedFiles: Set<string> = new Set();

  upsert(chunkId: string, embedding: number[], metadata: ChunkMetadata): void {
    this.vectors.set(chunkId, {
      chunkId,
      embedding,
      metadata,
    });
    this.indexedFiles.add(metadata.filePath);
  }

  upsertBatch(vectors: EmbeddingVector[]): void {
    for (const vector of vectors) {
      this.upsert(vector.chunkId, vector.embedding, vector.metadata);
    }
    logger.ragOperation('Upserted vectors', { count: vectors.length });
  }

  search(queryEmbedding: number[], topK: number = 10): RetrievedChunk[] {
    const results: Array<{ chunkId: string; score: number }> = [];

    for (const [chunkId, vector] of this.vectors) {
      const score = this.cosineSimilarity(queryEmbedding, vector.embedding);
      results.push({ chunkId, score });
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults.map((result) => {
      const vector = this.vectors.get(result.chunkId)!;
      return {
        id: result.chunkId,
        content: '',
        filePath: vector.metadata.filePath,
        score: result.score,
        metadata: vector.metadata,
      };
    });
  }

  getChunkContent(chunkId: string): string | undefined {
    return this.chunkContents.get(chunkId);
  }

  setChunkContent(chunkId: string, content: string): void {
    this.chunkContents.set(chunkId, content);
  }

  private chunkContents: Map<string, string> = new Map();

  getIndexedFiles(): string[] {
    return Array.from(this.indexedFiles);
  }

  hasFile(filePath: string): boolean {
    return this.indexedFiles.has(filePath);
  }

  removeFile(filePath: string): void {
    for (const [chunkId, vector] of this.vectors) {
      if (vector.metadata.filePath === filePath) {
        this.vectors.delete(chunkId);
        this.chunkContents.delete(chunkId);
      }
    }
    this.indexedFiles.delete(filePath);
  }

  clear(): void {
    this.vectors.clear();
    this.chunkContents.clear();
    this.indexedFiles.clear();
    logger.ragOperation('Vector store cleared');
  }

  stats(): { totalChunks: number; totalFiles: number } {
    return {
      totalChunks: this.vectors.size,
      totalFiles: this.indexedFiles.size,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

export const vectorStore = new VectorStore();
export { VectorStore };
