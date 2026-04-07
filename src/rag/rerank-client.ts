import { appConfig } from '../config';
import { logger } from '../core/logger';
import type { RetrievedChunk, RerankDocument, RerankResponse } from '../core/types';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number;

  constructor(ttlMs: number) {
    this.ttl = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

class RerankClient {
  private url: string;
  private timeout: number;
  private cache: SimpleCache<RetrievedChunk[]>;

  constructor() {
    this.url = appConfig.rerank.url;
    this.timeout = 60000;
    this.cache = new SimpleCache<RetrievedChunk[]>(300000);
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topN: number = 5
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const cacheKey = `${query}:${chunks.map(c => c.id).sort().join(',')}:${topN}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug('rag', 'Rerank cache hit', { query: query.substring(0, 50) });
      return cached;
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

      this.cache.set(cacheKey, rerankedChunks);

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
