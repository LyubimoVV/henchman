import { embedder } from './embedder';
import { vectorStore } from './vector-store';
import { rerankClient } from './rerank-client';
import { logger } from '../core/logger';
import type { RetrievedChunk } from '../core/types';

export interface SearchOptions {
  topK: number;
  rerankTopN: number;
  useRerank: boolean;
}

const DEFAULT_OPTIONS: SearchOptions = {
  topK: 20,
  rerankTopN: 5,
  useRerank: true,
};

class Retriever {
  private options: SearchOptions;

  constructor(options: Partial<SearchOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async search(query: string, options?: Partial<SearchOptions>): Promise<RetrievedChunk[]> {
    const opts = { ...this.options, ...options };

    logger.ragOperation('Searching', { query: query.substring(0, 50), topK: opts.topK });

    const queryEmbedding = await embedder.embed(query);
    let results = vectorStore.search(queryEmbedding, opts.topK);

    results = results.map((r) => ({
      ...r,
      content: vectorStore.getChunkContent(r.id) ?? '',
    }));

    if (opts.useRerank && results.length > 0) {
      try {
        results = await rerankClient.rerank(query, results, opts.rerankTopN);
      } catch (error) {
        logger.debug('rag', 'Rerank failed, using vector search results', {
          error: (error as Error).message,
        });
        results = results.slice(0, opts.rerankTopN);
      }
    }

    logger.ragOperation('Search complete', { results: results.length });

    return results;
  }

  async searchByFilePath(
    query: string,
    filePathPattern: string,
    options?: Partial<SearchOptions>
  ): Promise<RetrievedChunk[]> {
    const results = await this.search(query, { ...options, useRerank: false });

    return results.filter((r) =>
      r.filePath.toLowerCase().includes(filePathPattern.toLowerCase())
    );
  }
}

export const retriever = new Retriever();
export { Retriever };
