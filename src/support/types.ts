export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketCategory = 
  | 'auth' 
  | 'integration' 
  | 'rag' 
  | 'feature' 
  | 'memory' 
  | 'performance' 
  | 'mcp' 
  | 'tasks' 
  | 'context'
  | 'other';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  registeredAt: string;
  metadata: {
    company: string | null;
    experience: 'junior' | 'middle' | 'senior';
  };
}

export interface TicketMessage {
  from: 'user' | 'support';
  text: string;
  timestamp: string;
}

export interface TicketMetadata {
  browser?: string;
  os?: string;
  model?: string;
  contextStrategy?: string;
  ollamaVersion?: string;
  ollamaModel?: string;
  hardware?: string;
  rerankerPort?: string;
  mcpServerType?: string;
  taskFeature?: string;
  compressionKeepMessages?: string;
  compressionSummaryInterval?: string;
  [key: string]: string | undefined;
}

export interface Ticket {
  id: string;
  userId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  createdAt: string;
  resolvedAt?: string;
  messages: TicketMessage[];
  metadata: TicketMetadata;
}

export interface UsersData {
  users: User[];
}

export interface TicketsData {
  tickets: Ticket[];
}

export interface SupportContext {
  ticket: Ticket | null;
  user: User | null;
  ragContext: string;
}
