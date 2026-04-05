import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { dataStore } from '../../support/data-store';

export const getTicketTool: ToolDefinition = {
  name: 'get_ticket',
  category: 'mcp',
  description:
    'Get ticket details by ID including all messages and metadata. Also returns user information.',
  parameters: createSimpleToolSchema(
    {
      ticketId: {
        type: 'string',
        description: 'Ticket ID (e.g., TKT-001)',
      },
    },
    ['ticketId']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const ticketId = args['ticketId'] as string;

    if (!ticketId) {
      throw new Error('ticketId is required');
    }

    const result = await dataStore.getTicketWithUser(ticketId);

    if (!result) {
      return {
        success: false,
        result: null,
        error: `Ticket ${ticketId} not found`,
      };
    }

    return {
      success: true,
      result: {
        ticket: result.ticket,
        user: result.user,
      },
    };
  },
};
