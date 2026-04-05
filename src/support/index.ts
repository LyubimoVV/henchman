export { SupportAgent, type SupportAgentOptions, type SupportSession } from './support-agent';
export { dataStore, DataStore } from './data-store';
export type {
  User,
  Ticket,
  TicketMessage,
  TicketMetadata,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  UsersData,
  TicketsData,
  SupportContext,
} from './types';
export { buildSystemPrompt, formatRagChunks } from './prompts';
