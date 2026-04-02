import { appConfig } from '../config';
import { logger } from '../core/logger';
import type { RetrievedChunk, RerankDocument, RerankResponse } from '../core/types';

class RerankClient {
  private url: string;
  private timeout: number;

  constructor() {
    this.url = appConfig.rerank.url;
    this.timeout = 30000;
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topN: number = 5
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const documents: RerankDocument[] = chunks.map((c) => ({
      id: c.id,
      text: c.content,
    }));

    const request = {
      query,
      documents,
    };

    logger.ragOperation('Reranking', { query: query.substring(0, 50), documents: documents.length });
    logger.debug('rag', 'Rerank request', { url: this.url, query, documentsCount: documents.length });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.debug('rag', 'Rerank response error', { status: response.status, body: errorText });
        throw new Error(`Rerank service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as RerankResponse;

      const rerankedChunks = data.results
        .slice(0, topN)
        .map((result) => {
          const originalChunk = chunks.find((c) => c.id === result.id);
          if (!originalChunk) return null;

          return {
            ...originalChunk,
            score: result.score,
          };
        })
        .filter((c): c is RetrievedChunk => c !== null);

      logger.ragOperation('Rerank complete', { results: rerankedChunks.length });

      return rerankedChunks;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Rerank request timed out');
      }

      throw error;
    }
  }
}

export const rerankClient = new RerankClient();
export { RerankClient };
