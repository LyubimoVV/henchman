import type { Ticket, User, SupportContext } from './types';
import type { ChatMessage, RetrievedChunk } from '../core/types';
import { dataStore } from './data-store';
import { retriever } from '../rag/retriever';
import { llmClient } from '../llm/client';
import { buildSystemPrompt, formatRagChunks } from './prompts';
import { logger } from '../core/logger';

export interface SupportAgentOptions {
  projectPath: string;
  ticketId: string;
}

export interface SupportSession {
  ticket: Ticket;
  user: User | null;
  messages: ChatMessage[];
}

export class SupportAgent {
  private session: SupportSession | null = null;

  constructor(_options: SupportAgentOptions) {}

  async init(ticketId: string): Promise<boolean> {
    const result = await dataStore.getTicketWithUser(ticketId);

    if (!result) {
      logger.error('system', 'Ticket not found', { ticketId });
      return false;
    }

    this.session = {
      ticket: result.ticket,
      user: result.user,
      messages: [],
    };

    logger.info('system', 'Support session initialized', {
      ticketId,
      userId: result.ticket.userId,
    });

    return true;
  }

  getTicket(): Ticket | null {
    return this.session?.ticket ?? null;
  }

  getUser(): User | null {
    return this.session?.user ?? null;
  }

  async ask(question: string): Promise<string> {
    if (!this.session) {
      throw new Error('Session not initialized. Call init() first.');
    }

    logger.info('system', 'Processing support question', {
      question: question.substring(0, 50),
      ticketId: this.session.ticket.id,
    });

    const ragChunks = await this.searchRag(question);
    const systemPrompt = this.buildContext(ragChunks);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.session.messages,
      { role: 'user', content: question },
    ];

    const response = await llmClient.chatCompletion({
      messages,
      temperature: 0.7,
      maxTokens: 2048,
    });

    const answer = response.content ?? 'Не удалось получить ответ.';

    this.session.messages.push({ role: 'user', content: question });
    this.session.messages.push({ role: 'assistant', content: answer });

    return answer;
  }

  private async searchRag(query: string): Promise<RetrievedChunk[]> {
    try {
      const chunks = await retriever.search(query, {
        topK: 10,
        rerankTopN: 5,
        useRerank: true,
      });

      logger.debug('rag', 'RAG search for support', {
        query: query.substring(0, 50),
        results: chunks.length,
      });

      return chunks;
    } catch (error) {
      logger.warn('rag', 'RAG search failed, continuing without context', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  private buildContext(ragChunks: RetrievedChunk[]): string {
    if (!this.session) {
      throw new Error('Session not initialized');
    }

    const context: SupportContext = {
      ticket: this.session.ticket,
      user: this.session.user,
      ragContext: formatRagChunks(ragChunks),
    };

    return buildSystemPrompt(context);
  }

  reset(): void {
    if (this.session) {
      this.session.messages = [];
      logger.info('system', 'Support session reset', {
        ticketId: this.session.ticket.id,
      });
    }
  }
}
