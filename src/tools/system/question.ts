import type { ToolDefinition, JSONSchema } from '../../core/types';

export interface QuestionToolDeps {
  askUser: (questions: QuestionItem[]) => Promise<string[]>;
}

export interface QuestionItem {
  question: string;
  header: string;
  options?: string[];
}

export function createQuestionTool(deps: QuestionToolDeps): ToolDefinition {
  const parameters: JSONSchema = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Questions to ask the user',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question to ask' },
            header: { type: 'string', description: 'Short label for the question' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of choices',
            },
          },
          required: ['question', 'header'],
        },
      },
    },
    required: ['questions'],
  };

  return {
    name: 'question',
    category: 'system',
    description:
      'Ask the user a clarifying question during execution. ' +
      'Use when you need clarification, confirmation, or a decision before proceeding. ' +
      'The user response will be returned as an array of answers.',
    parameters,
    execute: async (args: Record<string, unknown>) => {
      const questions = args['questions'] as QuestionItem[];
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return { success: false, result: null, error: '"questions" array is required' };
      }

      try {
        const answers = await deps.askUser(questions);
        return {
          success: true,
          result: { answers },
        };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: (error as Error).message,
        };
      }
    },
  };
}
