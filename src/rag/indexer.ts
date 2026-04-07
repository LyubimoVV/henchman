import { readFile, stat } from 'fs/promises';
import { glob } from 'glob';
import { extname, join } from 'path';
import { chunker, type Chunk } from './chunker';
import { embedder } from './embedder';
import { vectorStore } from './vector-store';
import { logger } from '../core/logger';
import { detectProjectStructure, getExcludePatterns, type ProjectStructure } from '../core/project-structure';

const INDEXABLE_EXTENSIONS = [
  // Documentation
  '.md', '.txt', '.rst',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.ini', '.xml',
  // Source code - Java/Kotlin (for current project)
  '.java', '.kt', '.kts',
];

const INDEXABLE_PATTERNS = [
  'README*',
  'docs/**/*.md',
  'docs/**/*.rst',
  'docs/**/*.txt',
  '**/*.json',
  '**/*.yaml',
  '**/*.yml',
  // Source code - Java/Kotlin
  'src/**/*.java',
  'src/**/*.kt',
  'src/**/*.kts',
];

export interface IndexerResult {
  filesProcessed: number;
  chunksCreated: number;
  errors: string[];
}

class Indexer {
  private structure: ProjectStructure | null = null;

  async indexProject(projectPath: string): Promise<IndexerResult> {
    const result: IndexerResult = {
      filesProcessed: 0,
      chunksCreated: 0,
      errors: [],
    };

    logger.ragOperation('Starting project indexing', { projectPath });

    this.structure = detectProjectStructure(projectPath);
    
    logger.ragOperation('Detected project structure', {
      language: this.structure.language,
      buildTool: this.structure.buildTool,
      sourceDirs: this.structure.sourceDirs,
      buildDirs: this.structure.buildDirs,
    });

    const files = await this.discoverFiles(projectPath);
    logger.ragOperation('Discovered files', { count: files.length });

    for (const file of files) {
      try {
        const chunks = await this.indexFile(file, projectPath);
        result.filesProcessed++;
        result.chunksCreated += chunks.length;
      } catch (error) {
        result.errors.push(`${file}: ${(error as Error).message}`);
        logger.debug('rag', `Failed to index file: ${file}`);
      }
    }

    logger.ragOperation('Indexing complete', {
      files: result.filesProcessed,
      chunks: result.chunksCreated,
      errors: result.errors.length,
    });

    return result;
  }

  private async discoverFiles(projectPath: string): Promise<string[]> {
    const allFiles: Set<string> = new Set();

    const excludePatterns = this.structure 
      ? getExcludePatterns(this.structure)
      : [
        'node_modules/**',
        'dist/**',
        'build/**',
        '.git/**',
        'target/**',
        'bin/**',
        'out/**',
        '.gradle/**',
        '**/*.class',
        '**/*.jar',
        '.vscode/**',
        '**/*.iml',
        '**/surefire-reports/**',
        '**/test-classes/**',
      ];

    for (const pattern of INDEXABLE_PATTERNS) {
      const files = await glob(pattern, {
        cwd: projectPath,
        ignore: excludePatterns,
        nodir: true,
        absolute: true,
      });
      files.forEach((f) => allFiles.add(f));
    }

    return Array.from(allFiles);
  }

  private async indexFile(absolutePath: string, projectPath: string): Promise<Chunk[]> {
    const relativePath = absolutePath.replace(projectPath, '').replace(/^[/\\]/, '');

    if (vectorStore.hasFile(relativePath)) {
      logger.ragOperation('File already indexed, skipping', { file: relativePath });
      return [];
    }

    const ext = extname(absolutePath).toLowerCase();
    if (!INDEXABLE_EXTENSIONS.includes(ext)) {
      return [];
    }

    const content = await readFile(absolutePath, 'utf-8');
    const stats = await stat(absolutePath);

    if (content.length < 50) {
      return [];
    }

    const chunks = chunker.chunkFile(content, relativePath);

    if (chunks.length === 0) {
      return [];
    }

    const embeddings = await embedder.embedChunks(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;

      vectorStore.upsert(chunk.id, embedding.embedding, chunk.metadata);
      vectorStore.setChunkContent(chunk.id, chunk.content);
    }

    logger.ragOperation('Indexed file', {
      file: relativePath,
      chunks: chunks.length,
      size: stats.size,
    });

    return chunks;
  }

  async reindexFile(filePath: string, projectPath: string): Promise<Chunk[]> {
    const absolutePath = join(projectPath, filePath);
    vectorStore.removeFile(filePath);
    return this.indexFile(absolutePath, projectPath);
  }
}

export const indexer = new Indexer();
export { Indexer };
