import type { DiffResult, FileChange, ReviewResult, ReviewIssue } from './types';
import { llmClient } from '../llm/client';
import { retriever } from '../rag/retriever';
import { indexer } from '../rag/indexer';
import { vectorStore } from '../rag/vector-store';
import { logger } from '../core/logger';

export interface AnalyzerOptions {
  projectPath: string;
  useRag: boolean;
  debug: boolean;
}

const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided diff and identify:

1. **Bugs**: Potential bugs, null pointer errors, race conditions, off-by-one errors, unhandled edge cases
2. **Architecture**: SOLID violations, tight coupling, code duplication, improper abstractions, missing error handling
3. **Recommendations**: Performance improvements, readability, best practices, security concerns

Context from the codebase will be provided to help you understand the project structure.

Respond ONLY with valid JSON in this exact format:
{
  "issues": [
    {
      "type": "bug|architecture|recommendation",
      "file": "path/to/file.ts",
      "line": 10,
      "endLine": 15,
      "severity": "critical|warning|info",
      "message": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "summary": "Brief overall summary of the review"
}

Rules:
- Only report issues that are actually present in the diff
- Provide specific line numbers when possible (within the diff context)
- Be constructive and helpful
- Prioritize critical issues over minor style suggestions
- If no issues found, return empty issues array with a positive summary`;

export class ReviewAnalyzer {
  private projectPath: string;
  private useRag: boolean;

  constructor(options: AnalyzerOptions) {
    this.projectPath = options.projectPath;
    this.useRag = options.useRag;
    logger.setDebugMode(options.debug);
  }

  async analyze(diff: DiffResult): Promise<ReviewResult> {
    const startTime = Date.now();

    logger.info('main', 'Starting code review analysis', {
      files: diff.files.length,
      useRag: this.useRag,
    });

    let context = '';
    if (this.useRag) {
      context = await this.gatherRagContext(diff);
    }

    const issues: ReviewIssue[] = [];

    const batchSize = 5;
    const fileBatches = this.batchFiles(diff.files, batchSize);

    for (const batch of fileBatches) {
      const batchIssues = await this.analyzeBatch(batch, context, diff);
      issues.push(...batchIssues);
    }

    const summary = this.generateSummary(issues, diff);
    const duration = Date.now() - startTime;

    logger.info('main', 'Review complete', {
      issues: issues.length,
      duration,
    });

    return {
      issues,
      summary,
      stats: diff.stats,
      filesAnalyzed: diff.files.filter(f => f.status !== 'deleted').length,
      duration,
    };
  }

  private async gatherRagContext(diff: DiffResult): Promise<string> {
    logger.info('rag', 'Gathering RAG context for review');

    try {
      const indexedFiles = vectorStore.getIndexedFiles();
      if (indexedFiles.length === 0) {
        logger.info('rag', 'No indexed files, running auto-index');
        await indexer.indexProject(this.projectPath);
      }

      const changedPaths = diff.files
        .filter(f => f.status !== 'deleted')
        .map(f => f.path);

      const queries = [
        'error handling patterns',
        'similar implementations',
        'related classes and interfaces',
        'configuration and constants',
      ];

      const contexts: string[] = [];

      for (const query of queries) {
        try {
          const results = await retriever.search(query, { topK: 3, rerankTopN: 2 });
          for (const result of results) {
            if (!changedPaths.includes(result.filePath)) {
              contexts.push(`[${result.filePath}]: ${result.content.substring(0, 500)}`);
            }
          }
        } catch (error) {
          logger.debug('rag', `Search failed for query: ${query}`, {
            error: (error as Error).message,
          });
        }
      }

      return contexts.slice(0, 10).join('\n\n');
    } catch (error) {
      logger.warn('rag', 'RAG context gathering failed', {
        error: (error as Error).message,
      });
      return '';
    }
  }

  private batchFiles(files: FileChange[], batchSize: number): FileChange[][] {
    const batches: FileChange[][] = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }
    return batches;
  }

  private async analyzeBatch(
    files: FileChange[],
    context: string,
    diff: DiffResult
  ): Promise<ReviewIssue[]> {
    const diffContent = files
      .filter(f => f.status !== 'deleted')
      .map(f => `=== ${f.path} (${f.status}) ===\n${f.rawDiff}`)
      .join('\n\n');

    if (!diffContent.trim()) {
      return [];
    }

    const userMessage = this.buildUserMessage(files, diffContent, context, diff);

    try {
      const response = await llmClient.chatCompletion({
        messages: [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        maxTokens: 4096,
      });

      return this.parseResponse(response.content || '', files);
    } catch (error) {
      logger.error('main', 'LLM analysis failed', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  private buildUserMessage(
    files: FileChange[],
    diffContent: string,
    context: string,
    diff: DiffResult
  ): string {
    const parts: string[] = [];

    parts.push(`Review the following code changes.`);
    parts.push(`\nBase: ${diff.baseRef} → Head: ${diff.headRef}`);
    parts.push(`Files changed: ${files.length}, +${diff.stats.additions}/-${diff.stats.deletions}`);

    if (context) {
      parts.push(`\n## Relevant Codebase Context\n${context}`);
    }

    parts.push(`\n## Diff to Review\n\`\`\`diff\n${diffContent}\n\`\`\``);
    parts.push(`\nAnalyze and respond with JSON only.`);

    return parts.join('\n');
  }

  private parseResponse(content: string, files: FileChange[]): ReviewIssue[] {
    try {
      let jsonStr = content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr) as {
        issues: Array<{
          type: string;
          file: string;
          line?: number;
          endLine?: number;
          severity: string;
          message: string;
          suggestion?: string;
        }>;
        summary?: string;
      };

      const filePaths = files.map(f => f.path);

      return (parsed.issues || [])
        .filter(issue => filePaths.some(p => p.endsWith(issue.file) || issue.file.endsWith(p)))
        .map(issue => ({
          type: this.normalizeType(issue.type),
          file: issue.file,
          line: issue.line,
          endLine: issue.endLine,
          severity: this.normalizeSeverity(issue.severity),
          message: issue.message,
          suggestion: issue.suggestion,
        }));
    } catch (error) {
      logger.debug('main', 'Failed to parse LLM response', {
        error: (error as Error).message,
        content: content.substring(0, 200),
      });
      return [];
    }
  }

  private normalizeType(type: string): ReviewIssue['type'] {
    const normalized = type.toLowerCase();
    if (normalized.includes('bug') || normalized.includes('error')) return 'bug';
    if (normalized.includes('arch') || normalized.includes('design')) return 'architecture';
    return 'recommendation';
  }

  private normalizeSeverity(severity: string): ReviewIssue['severity'] {
    const normalized = severity.toLowerCase();
    if (normalized.includes('crit') || normalized.includes('error') || normalized.includes('high')) {
      return 'critical';
    }
    if (normalized.includes('warn') || normalized.includes('medium')) {
      return 'warning';
    }
    return 'info';
  }

  private generateSummary(issues: ReviewIssue[], diff: DiffResult): string {
    const critical = issues.filter(i => i.severity === 'critical').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const info = issues.filter(i => i.severity === 'info').length;

    const bugs = issues.filter(i => i.type === 'bug').length;
    const arch = issues.filter(i => i.type === 'architecture').length;
    const recs = issues.filter(i => i.type === 'recommendation').length;

    let summary = `## Code Review Summary\n\n`;
    summary += `📊 **Stats**: ${diff.stats.files} files, +${diff.stats.additions}/-${diff.stats.deletions} lines\n\n`;

    if (critical > 0) {
      summary += `🔴 **Critical**: ${critical} issue${critical > 1 ? 's' : ''}\n`;
    }
    if (warnings > 0) {
      summary += `🟡 **Warnings**: ${warnings} issue${warnings > 1 ? 's' : ''}\n`;
    }
    if (info > 0) {
      summary += `🔵 **Info**: ${info} suggestion${info > 1 ? 's' : ''}\n`;
    }

    summary += `\n**Breakdown**: ${bugs} potential bugs, ${arch} architecture concerns, ${recs} recommendations`;

    if (issues.length === 0) {
      summary += `\n\n✅ No significant issues found in this PR.`;
    }

    return summary;
  }
}

export function createReviewAnalyzer(options: AnalyzerOptions): ReviewAnalyzer {
  return new ReviewAnalyzer(options);
}
