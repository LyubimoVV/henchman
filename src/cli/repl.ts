import * as p from '@clack/prompts';
import pc from 'picocolors';
import { Orchestrator } from '../core/orchestrator';
import { handleHelpCommand, handleToolsCommand, handleStatusCommand, handleExitCommand } from '../commands';
import { handleIndexCommand } from '../commands/reindex';
import { logger } from '../core/logger';

export interface ReplOptions {
  projectPath: string;
  debug?: boolean;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  logger.setDebugMode(options.debug ?? false);

  p.intro(pc.cyan(pc.bold('Henchman - AI Developer Assistant')));

  logger.pause();
  
  const s = p.spinner();
  s.start('Initializing project...');

  const orchestrator = new Orchestrator({
    projectPath: options.projectPath,
    autoIndex: true,
  });

  s.stop('Project initialized');
  logger.resume();

  const context = orchestrator.getContext();
  console.log(pc.gray('\nProject Info:'));
  console.log(`  Path: ${context.projectPath}`);
  console.log(`  Branch: ${context.gitBranch ?? 'unknown'}\n`);

  while (true) {
    const input = await logger.withPaused(async () => 
      p.text({
        message: 'Ask a question',
        placeholder: 'Type /help for commands or ask about the project...',
      })
    );

    if (p.isCancel(input)) {
      p.outro(pc.yellow('Cancelled'));
      break;
    }

    const message = input as string;

    if (message.startsWith('/')) {
      const [command, ...args] = message.slice(1).split(' ');
      const argStr = args.join(' ');

      switch (command) {
        case 'help':
          if (options.debug) {
            console.log(pc.cyan('\nSearching...'));
            const helpResult = await handleHelpCommand(orchestrator, argStr);
            console.log('\n' + helpResult + '\n');
          } else {
            const helpResult = await logger.withPaused(async () => {
              const helpSpinner = p.spinner();
              helpSpinner.start('Searching...');
              const result = await handleHelpCommand(orchestrator, argStr);
              helpSpinner.stop();
              return result;
            });
            console.log('\n' + helpResult + '\n');
          }
          break;

        case 'index':
          if (options.debug) {
            console.log(pc.cyan('Re-indexing project...'));
            const indexResult = await handleIndexCommand(orchestrator);
            console.log(indexResult);
          } else {
            await logger.withPaused(async () => {
              const indexSpinner = p.spinner();
              indexSpinner.start('Re-indexing project...');
              const result = await handleIndexCommand(orchestrator);
              indexSpinner.stop(result);
            });
          }
          break;

        case 'tools':
          console.log('\n' + handleToolsCommand(orchestrator) + '\n');
          break;

        case 'status':
          console.log('\n' + handleStatusCommand(orchestrator) + '\n');
          break;

        case 'exit':
        case 'quit':
        case 'q':
          p.outro(handleExitCommand());
          return;

        default:
          console.log(pc.yellow(`Unknown command: /${command}`));
          console.log(pc.gray('Type /help to see available commands'));
      }

      console.log(pc.gray('\n  Commands: /help /index /tools /status /exit'));
      continue;
    }

    try {
      if (options.debug) {
        console.log(pc.cyan('\nThinking...'));
        const response = await orchestrator.handleMessage(message);
        console.log('\n' + pc.green('Response:') + '\n');
        console.log(response);
        console.log();
        console.log(pc.gray('  Commands: /help /index /tools /status /exit'));
      } else {
        const response = await logger.withPaused(async () => {
          const responseSpinner = p.spinner();
          responseSpinner.start('Thinking...');
          const result = await orchestrator.handleMessage(message);
          responseSpinner.stop();
          return result;
        });
        
        console.log('\n' + pc.green('Response:') + '\n');
        console.log(response);
        console.log();
        console.log(pc.gray('  Commands: /help /index /tools /status /exit'));
      }
    } catch (error) {
      console.log(pc.red(`Error: ${(error as Error).message}`));
      console.log(pc.gray('\n  Commands: /help /index /tools /status /exit'));
    }
  }
}
