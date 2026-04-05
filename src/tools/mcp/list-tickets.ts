import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { dataStore } from '../../support/data-store';
import type { TicketStatus, TicketCategory } from '../../support/types';

export const listTicketsTool: ToolDefinition = {
  name: 'list_tickets',
  category: 'mcp',
  description:
    'List tickets with optional filters. Returns ticket summary (id, subject, status, priority, category, userId).',
  parameters: createSimpleToolSchema(
    {
      status: {
        type: 'string',
        description: 'Filter by status: open, in_progress, waiting, closed',
        enum: ['open', 'in_progress', 'waiting', 'closed'],
      },
      category: {
        type: 'string',
        description:
          'Filter by category: auth, integration, rag, feature, memory, performance, mcp, tasks, context, other',
        enum: [
          'auth',
          'integration',
          'rag',
          'feature',
          'memory',
          'performance',
          'mcp',
          'tasks',
          'context',
          'other',
        ],
      },
      userId: {
        type: 'string',
        description: 'Filter by user ID',
      },
    },
    []
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const filters: { status?: TicketStatus; category?: TicketCategory; userId?: string } = {};

    if (args['status']) {
      filters.status = args['status'] as TicketStatus;
    }
    if (args['category']) {
      filters.category = args['category'] as TicketCategory;
    }
    if (args['userId']) {
      filters.userId = args['userId'] as string;
    }

    const tickets = await dataStore.listTickets(filters);

    return {
      success: true,
      result: {
        total: tickets.length,
        tickets: tickets.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          category: t.category,
          userId: t.userId,
          createdAt: t.createdAt,
        })),
      },
    };
  },
};
