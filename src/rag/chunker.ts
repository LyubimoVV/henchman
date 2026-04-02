import type { ChunkMetadata } from '../core/types';

export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkerOptions {
  maxTokens: number;
  overlap: number;
  minChunkSize: number;
}

const DEFAULT_OPTIONS: ChunkerOptions = {
  maxTokens: 500,
  overlap: 100,
  minChunkSize: 50,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function generateChunkId(filePath: string, index: number): string {
  const hash = filePath.split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `${hash}_${index}`;
}

class Chunker {
  private options: ChunkerOptions;

  constructor(options: Partial<ChunkerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  chunkText(
    text: string,
    filePath: string,
    startLine: number = 1
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const lines = text.split('\n');
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let chunkStartLine = startLine;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineTokens = estimateTokens(line);

      if (currentTokens + lineTokens > this.options.maxTokens && currentChunk.length > 0) {
        const content = currentChunk.join('\n');
        if (estimateTokens(content) >= this.options.minChunkSize) {
          chunks.push({
            id: generateChunkId(filePath, chunkIndex),
            content,
            metadata: {
              filePath,
              startLine: chunkStartLine,
              endLine: chunkStartLine + currentChunk.length - 1,
              chunkIndex,
            },
          });
          chunkIndex++;
        }

        const overlapLines = currentChunk.slice(-this.getOverlapLines(currentChunk));
        currentChunk = overlapLines;
        currentTokens = overlapLines.reduce((sum, l) => sum + estimateTokens(l), 0);
        chunkStartLine = i - overlapLines.length + 1;
      }

      currentChunk.push(line);
      currentTokens += lineTokens;
    }

    if (currentChunk.length > 0 && estimateTokens(currentChunk.join('\n')) >= this.options.minChunkSize) {
      chunks.push({
        id: generateChunkId(filePath, chunkIndex),
        content: currentChunk.join('\n'),
        metadata: {
          filePath,
          startLine: chunkStartLine,
          endLine: chunkStartLine + currentChunk.length - 1,
          chunkIndex,
        },
      });
    }

    return chunks;
  }

  private getOverlapLines(lines: string[]): number {
    let tokenCount = 0;
    let lineCount = 0;

    for (let i = lines.length - 1; i >= 0 && tokenCount < this.options.overlap; i--) {
      tokenCount += estimateTokens(lines[i]!);
      lineCount++;
    }

    return lineCount;
  }

  chunkFile(content: string, filePath: string): Chunk[] {
    return this.chunkText(content, filePath);
  }
}

export const chunker = new Chunker();
export { Chunker };
