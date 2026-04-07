import type { ChatMessage } from '../types';

export type SessionStatus = 'active' | 'completed' | 'cancelled';

export interface Session {
  id: string;
  parentId?: string;
  agentName: string;
  messages: ChatMessage[];
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}
