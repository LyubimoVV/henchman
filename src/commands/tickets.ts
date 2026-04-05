import pc from 'picocolors';
import { dataStore } from '../support/data-store';
import type { TicketStatus, TicketCategory } from '../support/types';

export async function handleTicketsCommand(filters?: {
  status?: TicketStatus;
  category?: TicketCategory;
}): Promise<string> {
  const tickets = await dataStore.listTickets(filters);

  if (tickets.length === 0) {
    return pc.yellow('No tickets found.');
  }

  const lines: string[] = [pc.bold('\n📋 Tickets\n')];

  tickets.forEach((ticket) => {
    const statusIcon = getStatusIcon(ticket.status);
    const priorityIcon = getPriorityIcon(ticket.priority);
    const statusColor = getStatusColor(ticket.status);

    lines.push(
      `${statusColor(`${statusIcon} ${ticket.id}`)} ${pc.gray('─')} ${ticket.subject}`
    );
    lines.push(
      pc.gray(`   ${priorityIcon} ${ticket.priority} | ${ticket.category} | ${ticket.createdAt.split('T')[0]}`)
    );
  });

  lines.push(pc.gray(`\nTotal: ${tickets.length} ticket(s)`));
  lines.push(pc.gray('Use /support <ticket_id> to start a support session'));

  return lines.join('\n');
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'open':
      return '🟡';
    case 'in_progress':
      return '🔵';
    case 'waiting':
      return '🟣';
    case 'closed':
      return '🟢';
    default:
      return '⚪';
  }
}

function getStatusColor(status: string) {
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

function getPriorityIcon(priority: string): string {
  switch (priority) {
    case 'critical':
      return '🔴';
    case 'high':
      return '🟠';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
    default:
      return '⚪';
  }
}
