import OpenAI from 'openai';
import type { ChatMessage } from '../core/types';
import { appConfig } from '../config';
import { logger } from '../core/logger';

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: ToolDescription[];
  temperature?: number;
  maxTokens?: number;
}

export interface ToolDescription {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ParsedToolCall[] | null;
  finishReason: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamEvent {
  type: 'text-delta' | 'tool-call-start' | 'tool-call-delta' | 'finish';
  text?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgumentsDelta?: string;
  finishReason?: string;
}

export interface StreamResult {
  content: string;
  toolCalls: ParsedToolCall[] | null;
  finishReason: string;
}

class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: appConfig.deepseek.apiKey,
      baseURL: appConfig.deepseek.baseUrl,
    });
    this.model = appConfig.deepseek.model;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<LLMResponse> {
    const { messages, tools, temperature = 0.7, maxTokens = 4096 } = options;

    logger.info('main', 'Calling DeepSeek API', {
      messageCount: messages.length,
      hasTools: !!tools,
      model: this.model,
    });

    try {
      const formattedMessages = this.formatMessages(messages);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: formattedMessages,
        tools: tools,
        tool_choice: tools ? 'auto' : undefined,
        temperature,
        max_tokens: maxTokens,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('No response choices returned from LLM');
      }

      logger.info('main', 'DeepSeek API response received', {
        finishReason: choice.finish_reason,
        hasContent: !!choice.message.content,
        contentLength: choice.message.content?.length ?? 0,
        toolCallsCount: choice.message.tool_calls?.length ?? 0,
      });

      const toolCalls = choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      return {
        content: choice.message.content,
        toolCalls: toolCalls ?? null,
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      const errDetails = error instanceof Error 
        ? { message: error.message, name: error.name }
        : { message: String(error) };
      
      logger.error('main', 'DeepSeek API error', errDetails);
      throw error;
    }
  }

  async *streamChatCompletion(
    options: ChatCompletionOptions
  ): AsyncGenerator<string, void, unknown> {
    const { messages, tools, temperature = 0.7, maxTokens = 4096 } = options;

    const formattedMessages = this.formatMessages(messages);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages,
      tools: tools,
      tool_choice: tools ? 'auto' : undefined,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async streamingChatCompletion(
    options: ChatCompletionOptions,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<StreamResult> {
    const { messages, tools, temperature = 0.7, maxTokens = 4096 } = options;
    const formattedMessages = this.formatMessages(messages);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages,
      tools,
      tool_choice: tools ? 'auto' : undefined,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let content = '';
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason = 'stop';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        content += choice.delta.content;
        onEvent?.({ type: 'text-delta', text: choice.delta.content });
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallsMap.set(tc.index, {
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments ?? '',
            });
            onEvent?.({
              type: 'tool-call-start',
              toolCallId: tc.id,
              toolCallName: tc.function.name,
            });
          } else if (tc.function?.arguments && toolCallsMap.has(tc.index)) {
            const existing = toolCallsMap.get(tc.index)!;
            existing.arguments += tc.function.arguments;
            onEvent?.({
              type: 'tool-call-delta',
              toolCallId: existing.id,
              toolCallArgumentsDelta: tc.function.arguments,
            });
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    onEvent?.({ type: 'finish', finishReason });

    const toolCalls: ParsedToolCall[] | null = toolCallsMap.size > 0
      ? Array.from(toolCallsMap.values()).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
        }))
      : null;

    return { content, toolCalls, finishReason };
  }

  private formatMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'tool' && msg.toolCallId) {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        } as OpenAI.ChatCompletionToolMessageParam;
      }

      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          role: 'assistant',
          content: msg.content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        } as OpenAI.ChatCompletionAssistantMessageParam;
      }

      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      } as OpenAI.ChatCompletionMessageParam;
    });
  }
}

export const llmClient = new LLMClient();
export { LLMClient };
