import type { ChatMessage, ToolDefinition } from './types';
import type { AgentInfo } from './agent/types';
import { llmClient, type ToolDescription } from '../llm/client';
import { toolExecutor } from './tool-executor';
import { buildToolSchemas } from '../llm/function-calling';
import { evaluatePermission } from './permission';
import { logger } from './logger';

export interface ToolUseLoopOptions {
  maxIterations: number;
  tools: ToolDefinition[];
  agent?: AgentInfo;
  signal?: AbortSignal;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown, success: boolean) => void;
  onContent?: (content: string) => void;
  onPermissionAsk?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
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
  const {
    maxIterations = 10,
    tools,
    agent,
    signal,
    onToolCall,
    onToolResult,
    onContent,
    onPermissionAsk,
  } = options;

  let currentMessages = [...messages];
  let iteration = 0;
  let totalToolCalls = 0;
  const toolSchemas: ToolDescription[] = buildToolSchemas(tools);

  logger.info('main', 'Starting Tool Use Loop', {
    maxIterations,
    toolsCount: tools.length,
    agent: agent?.name ?? 'default',
  });

  while (iteration < maxIterations) {
    if (signal?.aborted) {
      logger.info('main', 'Tool Use Loop aborted');
      break;
    }

    iteration++;
    logger.info('main', `Tool Use Loop iteration ${iteration}`);

    try {
      const response = await llmClient.streamingChatCompletion(
        {
          messages: currentMessages,
          tools: toolSchemas,
          temperature: agent?.temperature,
        },
        (event) => {
          if (event.type === 'text-delta' && event.text) {
            onContent?.(event.text);
          }
        },
      );

      logger.info('main', 'LLM response received', {
        hasContent: !!response.content,
        contentLength: response.content?.length ?? 0,
        toolCallsCount: response.toolCalls?.length ?? 0,
        finishReason: response.finishReason,
      });

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
        if (signal?.aborted) break;

        totalToolCalls++;
        onToolCall?.(toolCall.name, toolCall.arguments);

        if (agent) {
          const permAction = evaluatePermission(agent, toolCall.name);

          if (permAction === 'deny') {
            logger.warn('main', `Tool "${toolCall.name}" denied by agent permissions`, {
              agent: agent.name,
            });
            const denyMessage: ChatMessage = {
              role: 'tool',
              toolCallId: toolCall.id,
              content: JSON.stringify({ error: `Tool "${toolCall.name}" is not allowed for agent "${agent.name}"` }),
            };
            currentMessages.push(denyMessage);
            onToolResult?.(toolCall.name, null, false);
            continue;
          }

          if (permAction === 'ask' && onPermissionAsk) {
            const approved = await onPermissionAsk(toolCall.name, toolCall.arguments);
            if (!approved) {
              logger.info('main', `Tool "${toolCall.name}" denied by user`);
              const userDenyMessage: ChatMessage = {
                role: 'tool',
                toolCallId: toolCall.id,
                content: JSON.stringify({ error: `User denied execution of "${toolCall.name}"` }),
              };
              currentMessages.push(userDenyMessage);
              onToolResult?.(toolCall.name, null, false);
              continue;
            }
          }
        }

        const result = await toolExecutor.execute(
          toolCall.name,
          toolCall.arguments,
          undefined,
          signal,
        );

        onToolResult?.(toolCall.name, result.result, result.success);

        const toolMessage: ChatMessage = {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        };
        currentMessages.push(toolMessage);
      }
    } catch (error) {
      if (signal?.aborted) {
        logger.info('main', 'Tool Use Loop aborted during execution');
        break;
      }
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

  const lastAssistantMessage = [...currentMessages].reverse().find(m => m.role === 'assistant' && m.content);
  
  return {
    messages: currentMessages,
    finalContent: lastAssistantMessage?.content ?? '',
    toolCallsCount: totalToolCalls,
  };
}
