#!/usr/bin/env node

import { startRepl } from './cli/repl';
import { runOneshot } from './cli/oneshot';
import { runReviewCli, type ReviewCliOptions } from './cli/review';
import { appConfig } from './config';
import pc from 'picocolors';
import type { OutputFormat } from './review/types';

function printUsage(): void {
  console.log(`
${pc.cyan('Henchman')} - AI Developer Assistant

Usage:
  henchman [options]
  henchman <query> [options]
  henchman review [options]

Options:
  -p, --project <path>   Project directory (default: current directory)
  -d, --debug            Enable debug logging
  -h, --help             Show this help message

Commands:
  review                 Run AI code review on current changes

Review Options:
  --base <branch>        Base branch to compare (default: main)
  --head <branch>        Head branch (default: HEAD)
  --pr <number>          PR number to review (uses gh CLI)
  --format <type>        Output format: cli | github (default: cli)
  --output <file>        Write output to file
  --no-rag               Disable RAG context gathering
  --lang <code>          Language for output: en | ru (default: ru)

Commands (in REPL):
  /help [query]          Get help about the project
  /index                 Re-index project documentation
  /tools                 List available tools
  /status                Show current status
  /exit                  Exit the assistant

Examples:
  henchman                                    # Start REPL in current directory
  henchman -p /path/to/project                # Start REPL for specific project
  henchman "What is the project structure?"   # One-shot query
  henchman "Explain the API" -p ./myapp       # One-shot query for project
  henchman review                             # Review local changes
  henchman review --base develop              # Review against develop branch
  henchman review --pr 123 --format github    # Review PR #123 with GitHub format
`);
}

type Mode = 'help' | 'repl' | 'oneshot' | 'review';

interface ParsedArgs {
  mode: Mode;
  projectPath: string;
  query: string;
  debug: boolean;
  reviewOptions?: Partial<ReviewCliOptions>;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  let mode: Mode = 'repl';
  let projectPath = process.cwd();
  let query = '';
  let debug = false;
  const reviewOptions: Partial<ReviewCliOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    if (arg === '-h' || arg === '--help') {
      return { mode: 'help', projectPath, query, debug };
    }

    if (arg === '-d' || arg === '--debug') {
      debug = true;
      continue;
    }

    if (arg === '-p' || arg === '--project') {
      const nextArg = args[++i];
      if (!nextArg) {
        console.error(pc.red('Error: --project requires a path'));
        process.exit(1);
      }
      projectPath = nextArg;
      reviewOptions.projectPath = projectPath;
      continue;
    }

    if (arg === 'review') {
      mode = 'review';
      continue;
    }

    if (arg === '--base' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg) {
        reviewOptions.baseRef = nextArg;
      }
      continue;
    }

    if (arg === '--head' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg) {
        reviewOptions.headRef = nextArg;
      }
      continue;
    }

    if (arg === '--pr' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg) {
        reviewOptions.prNumber = parseInt(nextArg, 10);
      }
      continue;
    }

    if (arg === '--format' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg && (nextArg === 'cli' || nextArg === 'github')) {
        reviewOptions.format = nextArg as OutputFormat;
      }
      continue;
    }

    if (arg === '--output' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg) {
        reviewOptions.output = nextArg;
      }
      continue;
    }

    if (arg === '--no-rag' && mode === 'review') {
      reviewOptions.noRag = true;
      continue;
    }

    if (arg === '--lang' && mode === 'review') {
      const nextArg = args[++i];
      if (nextArg && (nextArg === 'en' || nextArg === 'ru')) {
        reviewOptions.lang = nextArg as 'en' | 'ru';
      }
      continue;
    }

    if (!arg.startsWith('-') && mode !== 'review') {
      query = query ? `${query} ${arg}` : arg;
    }
  }

  if (mode !== 'review' && query) {
    mode = 'oneshot';
  }

  return {
    mode,
    projectPath,
    query,
    debug,
    reviewOptions,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.mode === 'help') {
    printUsage();
    return;
  }

  if (!appConfig.deepseek.apiKey || appConfig.deepseek.apiKey === 'your_deepseek_api_key_here') {
    console.error(pc.red('Error: DEEPSEEK_API_KEY is not set.'));
    console.error(pc.gray('Create a .env file with: DEEPSEEK_API_KEY=your_key'));
    process.exit(1);
  }

  try {
    if (options.mode === 'review') {
      await runReviewCli({
        projectPath: options.projectPath,
        format: 'cli',
        noRag: false,
        debug: options.debug,
        ...options.reviewOptions,
      });
    } else if (options.mode === 'oneshot') {
      await runOneshot({
        projectPath: options.projectPath,
        query: options.query,
        debug: options.debug,
      });
    } else {
      await startRepl({
        projectPath: options.projectPath,
        debug: options.debug,
      });
    }
  } catch (error) {
    console.error(pc.red(`Fatal error: ${(error as Error).message}`));
    if (options.debug) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}

main();
