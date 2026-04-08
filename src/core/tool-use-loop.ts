import type { ChatMessage, ToolDefinition } from './types';
import type { AgentInfo } from './agent/types';
import { llmClient, type ToolDescription } from '../llm/client';
import { toolExecutor } from './tool-executor';
import { buildToolSchemas } from '../llm/function-calling';
import { evaluatePermission } from './permission';
import { extractDelegateFromContent } from '../tools/system/delegate';
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
  let hasSuccessfulToolResult = false;
  const toolSchemas: ToolDescription[] = buildToolSchemas(tools);
  const isDelegateOnly = tools.length > 0 && tools.every(t => t.name === 'delegate' || t.name === 'question');
  const effectiveToolChoice: 'auto' | 'required' | undefined = isDelegateOnly ? 'required' : undefined;

  let currentToolChoice: 'auto' | 'required' | undefined = effectiveToolChoice;

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
          toolChoice: currentToolChoice,
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

      if (hasSuccessfulToolResult && response.content && response.content.trim().length > 0
          && (!response.toolCalls || response.toolCalls.length === 0)) {
        logger.info('main', 'Early stopping: tool result processed, LLM provided answer');
        currentMessages.push({ role: 'assistant', content: response.content });
        return {
          messages: currentMessages,
          finalContent: response.content,
          toolCallsCount: totalToolCalls,
        };
      }
      
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const extracted = extractDelegateFromContent(response.content ?? '');
        if (extracted) {
          logger.info('main', 'Falling back to content-extracted delegate call');
          response.toolCalls = [{
            id: `extracted_${Date.now()}`,
            name: 'delegate',
            arguments: { pattern: extracted.pattern, config: extracted.config },
          }];
        } else {
          logger.info('main', 'Tool Use Loop completed - no tool calls', {
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
      } else if (response.toolCalls.length === 0 && !response.content) {
        logger.warn('main', 'LLM returned empty response');
      }

      if (iteration >= maxIterations - 3 && iteration < maxIterations) {
        logger.debug('main', 'Approaching max iterations', {
          currentIteration: iteration,
          maxIterations,
          toolCallsSoFar: totalToolCalls + response.toolCalls.length,
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

        if (result.success) {
          hasSuccessfulToolResult = true;
        }

        if (toolCall.name === 'delegate' && result.success) {
          currentToolChoice = undefined;
          const delegateData = result.result as { pattern: string; data: unknown } | undefined;
          if (delegateData?.data) {
            const delegationResults = Array.isArray(delegateData.data) ? delegateData.data : [delegateData.data];
            const results = delegationResults as Array<{ status: string }>;
            const allFailed = results.every(r => r.status === 'error');
            const anySuccess = results.some(r => r.status === 'success');
            if (!allFailed && anySuccess) {
              hasSuccessfulToolResult = true;
            }
          } else {
            hasSuccessfulToolResult = true;
          }
        }

        const toolMessage: ChatMessage = {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        };
        currentMessages.push(toolMessage);

        if (toolCall.name === 'delegate' && result.success && hasSuccessfulToolResult) {
          currentMessages.push({
            role: 'system',
            content: 'IMPORTANT: Delegate returned results successfully. You MUST now provide a FINAL TEXT ANSWER to the user. Do NOT call any more tools. Do NOT ask questions. Just summarize and present the results.',
          });
        }
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

  if (hasSuccessfulToolResult) {
    const toolMessages = currentMessages.filter(m => m.role === 'tool');
    for (const msg of [...toolMessages].reverse()) {
      try {
        const parsed = JSON.parse(msg.content || '');
        if (parsed?.data) {
          const dataStr = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data, null, 2);
          if (dataStr.length > 0) {
            logger.info('main', 'Returning delegate data as fallback after max iterations');
            return { messages: currentMessages, finalContent: dataStr, toolCallsCount: totalToolCalls };
          }
        }
      } catch { /* skip */ }
    }
  }

  const lastAssistantMessage = [...currentMessages].reverse().find(m => m.role === 'assistant' && m.content);
   
  return {
    messages: currentMessages,
    finalContent: lastAssistantMessage?.content ?? '',
    toolCallsCount: totalToolCalls,
  };
}
