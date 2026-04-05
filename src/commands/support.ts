import * as p from '@clack/prompts';
import pc from 'picocolors';
import { SupportAgent } from '../support';
import { logger } from '../core/logger';

export interface SupportCommandOptions {
  projectPath: string;
  debug?: boolean;
}

export async function handleSupportCommand(
  ticketId: string,
  options: SupportCommandOptions
): Promise<void> {
  logger.setDebugMode(options.debug ?? false);

  const agent = new SupportAgent({ projectPath: options.projectPath, ticketId });

  const initSpinner = p.spinner();
  initSpinner.start(`Loading ticket ${ticketId}...`);

  const initialized = await agent.init(ticketId);

  if (!initialized) {
    initSpinner.stop(`Ticket ${ticketId} not found`);
    console.log(pc.red(`\nTicket ${ticketId} not found. Check the ID and try again.`));
    return;
  }

  const ticket = agent.getTicket();
  const user = agent.getUser();

  initSpinner.stop('Ticket loaded');

  console.log(pc.cyan('\n' + '═'.repeat(60)));
  console.log(pc.bold('📋 Support Session'));
  console.log(pc.cyan('═'.repeat(60)));
  console.log(`${pc.bold('Ticket:')} ${ticket?.id} - ${ticket?.subject}`);
  console.log(`${pc.bold('Status:')} ${getStatusColor(ticket?.status)(ticket?.status ?? '')}`);
  console.log(`${pc.bold('Priority:')} ${getPriorityColor(ticket?.priority)(ticket?.priority ?? '')}`);
  console.log(`${pc.bold('User:')} ${user?.name} (${user?.email})`);
  console.log(`${pc.bold('Plan:')} ${user?.plan}`);
  console.log(pc.cyan('═'.repeat(60)));
  console.log(pc.gray('\nAsk questions about this ticket. Type /done or /exit to leave.\n'));

  while (true) {
    const input = await logger.withPaused(async () =>
      p.text({
        message: pc.cyan('Support question'),
        placeholder: 'Ask about the ticket or type /done to exit...',
      })
    );

    if (p.isCancel(input)) {
      console.log(pc.yellow('\nExiting support session...'));
      break;
    }

    const message = (input as string).trim();

    if (message.startsWith('/')) {
      const command = message.slice(1).toLowerCase();
      if (command === 'exit' || command === 'done' || command === 'q') {
        console.log(pc.green('\n✓ Support session closed\n'));
        break;
      }
      console.log(pc.yellow(`Unknown command: ${message}`));
      console.log(pc.gray('Type /done or /exit to leave support session'));
      continue;
    }

    if (!message) continue;

    const answerSpinner = p.spinner();
    try {
      answerSpinner.start('Searching documentation and generating answer...');

      const answer = await agent.ask(message);

      answerSpinner.stop();

      console.log('\n' + pc.green('Answer:') + '\n');
      console.log(answer);
      console.log('\n' + '─'.repeat(60));
    } catch (error) {
      answerSpinner.stop();
      logger.error('system', 'Failed to generate answer', { error });
      console.log(pc.red('\nError generating answer. Please try again.\n'));
    }
  }
}

function getStatusColor(status: string | undefined) {
  switch (status) {
    case 'open':
      return pc.yellow;
    case 'in_progress':
      return pc.blue;
    case 'waiting':
      return pc.magenta;
    case 'closed':
      return pc.green;
    default:
      return pc.gray;
  }
}

function getPriorityColor(priority: string | undefined) {
  switch (priority) {
    case 'critical':
      return pc.red;
    case 'high':
      return pc.yellow;
    case 'medium':
      return pc.blue;
    case 'low':
      return pc.gray;
    default:
      return pc.white;
  }
}
