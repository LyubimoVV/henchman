#!/usr/bin/env node

import { startRepl } from './cli/repl';
import { runOneshot } from './cli/oneshot';
import { appConfig } from './config';
import pc from 'picocolors';

function printUsage(): void {
  console.log(`
${pc.cyan('Henchman')} - AI Developer Assistant

Usage:
  henchman [options]
  henchman <query> [options]

Options:
  -p, --project <path>   Project directory (default: current directory)
  -d, --debug            Enable debug logging
  -h, --help             Show this help message

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
`);
}

function parseArgs(): {
  mode: 'help' | 'repl' | 'oneshot';
  projectPath: string;
  query: string;
  debug: boolean;
} {
  const args = process.argv.slice(2);

  let projectPath = process.cwd();
  let query = '';
  let debug = false;

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
      continue;
    }

    if (!arg.startsWith('-')) {
      query = query ? `${query} ${arg}` : arg;
    }
  }

  return {
    mode: query ? 'oneshot' : 'repl',
    projectPath,
    query,
    debug,
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
    if (options.mode === 'oneshot') {
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
