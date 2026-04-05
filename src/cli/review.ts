import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import type { ReviewOptions, ReviewResult, OutputFormat } from '../review/types';
import { runReview } from '../review';
import { formatReview, createGitHubAnnotations } from '../review/formatter';
import { logger } from '../core/logger';

export interface ReviewCliOptions {
  projectPath: string;
  baseRef?: string;
  headRef?: string;
  prNumber?: number;
  format: OutputFormat;
  output?: string;
  noRag: boolean;
  debug: boolean;
  lang?: 'en' | 'ru';
}

export async function runReviewCli(options: ReviewCliOptions): Promise<void> {
  logger.setDebugMode(options.debug);

  console.log(pc.cyan('🔍 Henchman Code Review'));
  console.log();

  if (options.prNumber) {
    console.log(pc.gray(`PR: #${options.prNumber}`));
  } else if (options.baseRef) {
    console.log(pc.gray(`Base: ${options.baseRef} → Head: ${options.headRef || 'HEAD'}`));
  }
  console.log();

  const spinner = showSpinner('Analyzing code changes...');

  try {
    const reviewOptions: ReviewOptions = {
      projectPath: options.projectPath,
      baseRef: options.baseRef,
      headRef: options.headRef,
      prNumber: options.prNumber,
      format: options.format,
      useRag: !options.noRag,
      debug: options.debug,
      lang: options.lang || 'ru',
    };

    const result = await runReview(reviewOptions);

    hideSpinner(spinner);

    if (options.format === 'github') {
      await handleGitHubOutput(result, options);
    } else {
      const output = formatReview(result, options.format);

      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.log(pc.green(`✓ Review saved to ${options.output}`));
      } else {
        console.log(output);
      }
    }

    const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
    if (criticalCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    hideSpinner(spinner);
    console.log();
    console.log(pc.red(`Error: ${(error as Error).message}`));
    if (options.debug) {
      console.log((error as Error).stack);
    }
    process.exit(1);
  }
}

async function handleGitHubOutput(
  result: ReviewResult,
  options: ReviewCliOptions
): Promise<void> {
  const commentPath = path.join(options.projectPath, '.henchman-review-comment.md');
  const annotationsPath = path.join(options.projectPath, '.henchman-annotations.json');

  const comment = formatReview(result, 'github');
  fs.writeFileSync(commentPath, comment);
  console.log(pc.green(`✓ Review comment saved to ${commentPath}`));

  const annotations = createGitHubAnnotations(result);
  if (annotations.length > 0) {
    try {
      fs.writeFileSync(annotationsPath, JSON.stringify(annotations, null, 2));
      console.log(pc.green(`✓ Annotations saved to ${annotationsPath}`));
    } catch (error) {
      console.log(pc.yellow(`⚠ Could not save annotations: ${(error as Error).message}`));
    }
  }

  console.log();
  console.log(pc.gray('To post as PR comment:'));
  console.log(pc.gray(`  gh pr comment ${options.prNumber || '<PR_NUMBER>'} --body-file .henchman-review-comment.md`));
}

function showSpinner(message: string): NodeJS.Timeout {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  process.stdout.write(pc.cyan(frames[0] + ' ' + message));

  return setInterval(() => {
    process.stdout.write('\r' + pc.cyan(frames[i] + ' ' + message));
    i = (i + 1) % frames.length;
  }, 80);
}

function hideSpinner(spinner: NodeJS.Timeout): void {
  clearInterval(spinner);
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
}
