import type { ToolDefinition, ToolResult } from '../../core/types';
import { createSimpleToolSchema } from '../../llm/function-calling';
import { dataStore } from '../../support/data-store';

export const getUserTool: ToolDefinition = {
  name: 'get_user',
  category: 'mcp',
  description: 'Get user details by ID including plan, experience level and metadata.',
  parameters: createSimpleToolSchema(
    {
      userId: {
        type: 'string',
        description: 'User ID (e.g., usr_001)',
      },
    },
    ['userId']
  ),
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const userId = args['userId'] as string;

    if (!userId) {
      throw new Error('userId is required');
    }

    const user = await dataStore.getUser(userId);

    if (!user) {
      return {
        success: false,
        result: null,
        error: `User ${userId} not found`,
      };
    }

    return {
      success: true,
      result: user,
    };
  },
};
