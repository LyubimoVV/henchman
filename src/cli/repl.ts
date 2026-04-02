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

  const s = p.spinner();
  s.start('Initializing project...');

  const orchestrator = new Orchestrator({
    projectPath: options.projectPath,
    autoIndex: true,
  });

  s.stop('Project initialized');

  const context = orchestrator.getContext();
  console.log(pc.gray('\nProject Info:'));
  console.log(`  Path: ${context.projectPath}`);
  console.log(`  Branch: ${context.gitBranch ?? 'unknown'}\n`);

  while (true) {
    const input = await p.text({
      message: 'Ask a question',
      placeholder: 'Type /help for commands or ask about the project...',
    });

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
          const helpSpinner = p.spinner();
          helpSpinner.start('Searching...');
          const helpResult = await handleHelpCommand(orchestrator, argStr);
          helpSpinner.stop();
          console.log('\n' + helpResult + '\n');
          break;

        case 'index':
          const indexSpinner = p.spinner();
          indexSpinner.start('Re-indexing project...');
          const indexResult = await handleIndexCommand(orchestrator);
          indexSpinner.stop(indexResult);
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

      continue;
    }

    const responseSpinner = p.spinner();
    responseSpinner.start('Thinking...');

    try {
      const response = await orchestrator.handleMessage(message);
      responseSpinner.stop();
      console.log('\n' + pc.green('Response:') + '\n');
      console.log(response);
      console.log();
    } catch (error) {
      responseSpinner.stop();
      console.log(pc.red(`Error: ${(error as Error).message}`));
    }
  }
}
