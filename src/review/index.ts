import type { ReviewOptions, ReviewResult, OutputFormat } from './types';
import { DiffFetcher } from './diff-fetcher';
import { ReviewAnalyzer } from './analyzer';
import { formatReview, formatJson, createGitHubCheckOutput, createGitHubAnnotations } from './formatter';
import { logger } from '../core/logger';

export * from './types';
export * from './diff-fetcher';
export * from './analyzer';
export * from './formatter';

export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  logger.setDebugMode(options.debug);

  logger.info('main', 'Starting code review', {
    projectPath: options.projectPath,
    prNumber: options.prNumber,
    format: options.format,
  });

  const diffFetcher = new DiffFetcher({
    projectPath: options.projectPath,
    baseRef: options.baseRef,
    headRef: options.headRef,
    prNumber: options.prNumber,
  });

  const diff = await diffFetcher.fetchDiff({
    projectPath: options.projectPath,
    baseRef: options.baseRef,
    headRef: options.headRef,
    prNumber: options.prNumber,
  });

  logger.info('main', 'Diff fetched', {
    files: diff.files.length,
    additions: diff.stats.additions,
    deletions: diff.stats.deletions,
  });

  const analyzer = new ReviewAnalyzer({
    projectPath: options.projectPath,
    useRag: options.useRag,
    debug: options.debug,
    lang: options.lang,
  });

  const result = await analyzer.analyze(diff);

  return result;
}

export function formatOutput(result: ReviewResult, format: OutputFormat): string {
  return formatReview(result, format);
}

export { formatJson, createGitHubCheckOutput, createGitHubAnnotations };
