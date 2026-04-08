import * as p from '@clack/prompts';
import pc from 'picocolors';
import { Orchestrator } from '../core/orchestrator';
import { handleHelpCommand, handleToolsCommand, handleStatusCommand, handleExitCommand, handleSupportCommand, handleTicketsCommand } from '../commands';
import { handleIndexCommand } from '../commands/reindex';
import { agentRegistry } from '../core/agent/registry';
import { logger } from '../core/logger';
import { StreamContentFilter } from './stream-filter';

export interface ReplOptions {
  projectPath: string;
  debug?: boolean;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  logger.setDebugMode(options.debug ?? false);

  p.intro(pc.cyan(pc.bold('Henchman - AI Developer Assistant')));

  logger.pause();
  
  const initSpinner = p.spinner();
  initSpinner.start('Initializing project...');

  let activeSpinner: ReturnType<typeof p.spinner> | null = null;
  let streamingStarted = false;
  let contentFilter: StreamContentFilter | null = null;

  const orchestrator = new Orchestrator({
    projectPath: options.projectPath,
    autoIndex: true,
    onContent: (chunk) => {
      if (activeSpinner && !streamingStarted) {
        activeSpinner.stop();
        activeSpinner = null;
        streamingStarted = true;
        process.stdout.write(pc.cyan('\n'));
      }
      if (streamingStarted && contentFilter) {
        contentFilter.push(chunk);
      }
    },
    onPermissionAsk: async (toolName, _args) => {
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      logger.resume();
      const answer = await p.confirm({
        message: `Allow tool "${toolName}" to execute?`,
        initialValue: true,
      });
      logger.pause();
      return !p.isCancel(answer) && answer === true;
    },
    onToolCall: (toolName) => {
      if (activeSpinner) {
        activeSpinner.message(`Executing ${toolName}...`);
      }
    },
  });

  initSpinner.stop('Project initialized');
  logger.resume();

  const context = orchestrator.getContext();
  console.log(pc.gray(`\nProject Info:\n  Path: ${context.projectPath}`));
  console.log(pc.gray(`  Agent: ${orchestrator.getCurrentAgent().name}`));
  console.log(pc.gray('  Switch agents: /agent build | /agent plan'));
  console.log(pc.gray('  Stop execution: /stop\n'));

  while (true) {
    const agentName = orchestrator.getCurrentAgent().name;
    const input = await logger.withPaused(async () => 
      p.text({
        message: `[${agentName}] Ask a question`,
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

        case 'tickets':
          const ticketsResult = await handleTicketsCommand();
          console.log(ticketsResult + '\n');
          break;

        case 'support':
          if (!argStr) {
            console.log(pc.yellow('Usage: /support <ticket_id>'));
            console.log(pc.gray('Example: /support TKT-001'));
            console.log(pc.gray('Use /tickets to see available tickets'));
          } else {
            await handleSupportCommand(argStr, {
              projectPath: options.projectPath,
              debug: options.debug,
            });
          }
          break;

        case 'agent':
          if (!argStr) {
            const agents = agentRegistry.primaryAgents();
            console.log(pc.cyan('\nAvailable agents:'));
            for (const a of agents) {
              const current = a.name === orchestrator.getCurrentAgent().name ? ' (current)' : '';
              console.log(`  ${pc.bold(a.name)}${pc.gray(current)} - ${a.description}`);
            }
            console.log(pc.gray('\nUsage: /agent <name>'));
          } else {
            const switched = orchestrator.switchAgent(argStr);
            if (switched) {
              console.log(pc.green(`Switched to agent: ${argStr}`));
            } else {
              console.log(pc.red(`Unknown agent: ${argStr}`));
              console.log(pc.gray(`Available: ${agentRegistry.primaryAgents().map(a => a.name).join(', ')}`));
            }
          }
          break;

        case 'stop':
          orchestrator.cancel();
          console.log(pc.yellow('Execution cancelled'));
          break;

        case 'plan':
          if (!argStr) {
            console.log(pc.yellow('Usage: /plan <goal>'));
            console.log(pc.gray('Example: /plan Analyze authentication flow'));
          } else {
            if (options.debug) {
              console.log(pc.cyan('\nPlanning...'));
              const response = await orchestrator.handleMessageWithPlan(argStr);
              console.log('\n' + pc.green('Result:') + '\n');
              console.log(response);
            } else {
              const response = await logger.withPaused(async () => {
                const planSpinner = p.spinner();
                planSpinner.start('Planning...');
                const result = await orchestrator.handleMessageWithPlan(argStr);
                planSpinner.stop();
                return result;
              });
              console.log('\n' + pc.green('Result:') + '\n');
              console.log(response);
            }
          }
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

      console.log(pc.gray('\n  Commands: /help /index /tools /status /agent /stop /plan /exit'));
      continue;
    }

    try {
      streamingStarted = false;
      contentFilter = new StreamContentFilter((text) => process.stdout.write(text));
      
      activeSpinner = p.spinner();
      activeSpinner.start('Thinking...');
      
      const response = await orchestrator.handleMessage(message);
      
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      
      if (streamingStarted && contentFilter) {
        contentFilter.flush();
        process.stdout.write('\n');
      } else {
        console.log(pc.green('Response:'));
        console.log(response);
      }
      console.log();
      console.log(pc.gray('  Commands: /help /index /tools /status /agent /stop /plan /exit'));
    } catch (error) {
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      console.log(pc.red(`Error: ${(error as Error).message}`));
      console.log(pc.gray('\n  Commands: /help /index /tools /status /agent /stop /plan /exit'));
    }
  }
}
