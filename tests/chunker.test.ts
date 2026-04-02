import { describe, it, expect } from 'vitest';
import { Chunker } from '../src/rag/chunker';

describe('Chunker', () => {
  const chunker = new Chunker({ minChunkSize: 10 });

  it('should split long content into chunks', () => {
    const content = 'A'.repeat(600);
    const chunks = chunker.chunkFile(content, 'test.txt');
    
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should create chunks with correct metadata', () => {
    const content = 'Line 1 with some content\nLine 2 with more content\nLine 3 even more content here\nLine 4 additional text\nLine 5 final content line';
    const chunks = chunker.chunkFile(content, 'test.txt');
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.metadata.filePath).toBe('test.txt');
    expect(chunks[0]!.metadata.startLine).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.chunkIndex).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty content', () => {
    const chunks = chunker.chunkFile('', 'empty.txt');
    
    expect(chunks).toHaveLength(0);
  });

  it('should handle short content below min chunk size', () => {
    const content = 'Short';
    const chunks = chunker.chunkFile(content, 'short.txt');
    
    expect(chunks).toHaveLength(0);
  });

  it('should generate unique IDs for chunks', () => {
    const content = 'A'.repeat(600);
    const chunks = chunker.chunkFile(content, 'test.txt');
    
    const ids = chunks.map(c => c.id);
    const uniqueIds = new Set(ids);
    
    expect(uniqueIds.size).toBe(ids.length);
  });
});
