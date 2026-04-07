import type { ChatMessage, ToolDefinition } from './types';
import { llmClient, type ToolDescription } from '../llm/client';
import { toolExecutor } from './tool-executor';
import { buildToolSchemas } from '../llm/function-calling';
import { logger } from './logger';

export interface ToolUseLoopOptions {
  maxIterations: number;
  tools: ToolDefinition[];
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown, success: boolean) => void;
  onContent?: (content: string) => void;
}

export interface ToolUseLoopResult {
  messages: ChatMessage[];
  finalContent: string;
  toolCallsCount: number;
}

export async function toolUseLoop(
  messages: ChatMessage[],
  options: ToolUseLoopOptions
): Promise<ToolUseLoopResult> {
  const { maxIterations = 10, tools, onToolCall, onToolResult, onContent } = options;

  let currentMessages = [...messages];
  let iteration = 0;
  let totalToolCalls = 0;
  const toolSchemas: ToolDescription[] = buildToolSchemas(tools);

  logger.info('main', 'Starting Tool Use Loop', {
    maxIterations,
    toolsCount: tools.length,
  });

  while (iteration < maxIterations) {
    iteration++;
    logger.info('main', `Tool Use Loop iteration ${iteration}`);

    try {
      const response = await llmClient.chatCompletion({
        messages: currentMessages,
        tools: toolSchemas,
      });

      logger.info('main', 'LLM response received', {
        hasContent: !!response.content,
        contentLength: response.content?.length ?? 0,
        toolCallsCount: response.toolCalls?.length ?? 0,
        finishReason: response.finishReason,
      });

      if (response.content) {
        onContent?.(response.content);
      }

      // Early exit: если LLM дал ответ без tool calls, задача выполнена
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.info('main', 'Tool Use Loop completed', {
          iterations: iteration,
          totalToolCalls,
          reason: response.content ? 'llm_provided_answer' : 'no_tool_calls',
        });
        return {
          messages: currentMessages,
          finalContent: response.content ?? '',
          toolCallsCount: totalToolCalls,
        };
      }

      // Warning if approaching max iterations
      if (iteration >= maxIterations - 3 && iteration < maxIterations) {
        logger.warn('main', 'Approaching max iterations', {
          currentIteration: iteration,
          maxIterations,
          toolCallsSoFar: totalToolCalls + response.toolCalls.length,
          recommendation: 'Consider providing answer with current information',
        });
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls,
      };
      currentMessages.push(assistantMessage);

      for (const toolCall of response.toolCalls) {
        totalToolCalls++;
        onToolCall?.(toolCall.name, toolCall.arguments);

        const result = await toolExecutor.execute(toolCall.name, toolCall.arguments);

        onToolResult?.(toolCall.name, result.result, result.success);

        const toolMessage: ChatMessage = {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        };
        currentMessages.push(toolMessage);
      }
    } catch (error) {
      logger.error('main', 'Error in Tool Use Loop', {
        iteration,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.warn('main', `Tool Use Loop reached max iterations (${maxIterations})`, {
    iterations: iteration,
    totalToolCalls,
    hasUnfinishedContent: !!currentMessages[currentMessages.length - 1]?.content,
  });

  // Попытка сформировать частичный ответ из последних сообщений
  const lastAssistantMessage = [...currentMessages].reverse().find(m => m.role === 'assistant' && m.content);
  
  return {
    messages: currentMessages,
    finalContent: lastAssistantMessage?.content ?? '',
    toolCallsCount: totalToolCalls,
  };
}
