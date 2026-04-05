export type ToolCategory = 'rag' | 'mcp' | 'system';
export type LogCategory = 'main' | 'subagent' | 'rag' | 'mcp' | 'system' | 'tool' | 'delegation';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ErrorStrategy = 'retry' | 'fallback' | 'abort' | 'ask_user';

export interface BaseContext {
  projectPath: string;
  gitBranch?: string;
  indexedFiles: string[];
  lastQuery?: string;
  retrievedChunks?: RetrievedChunk[];
  [key: string]: unknown;
}

export interface SubagentContext extends BaseContext {
  taskId: string;
  taskDescription: string;
  parentAgentId: string;
  allowedTools: string[];
}

export interface SubagentInfo {
  id: string;
  task: string;
  status: 'spawning' | 'executing' | 'reporting' | 'completed' | 'failed';
}

export interface ConversationContext extends BaseContext {
  messages: ChatMessage[];
  activeSubagents: SubagentInfo[];
  modifiedFiles: string[];
}

export interface RetrievedChunk {
  id: string;
  content: string;
  filePath: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  result: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  parameters: JSONSchema;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolError {
  toolName: string;
  error: Error;
  args: Record<string, unknown>;
  attempt: number;
}

export interface SubagentTask {
  id: string;
  description: string;
  tools: ToolDefinition[];
  contextIn: SubagentContext;
}

export interface SubagentResult {
  taskId: string;
  status: 'success' | 'error';
  data: unknown;
  filesModified: string[];
  logs: string[];
  contextOut: Partial<SubagentContext>;
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta?: Record<string, unknown>;
}

export interface ErrorHandler {
  handle(error: ToolError): Promise<ErrorStrategy>;
}

export interface EmbeddingVector {
  chunkId: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  filePath: string;
  startLine: number;
  endLine: number;
  chunkIndex: number;
  [key: string]: unknown;
}

export interface RerankDocument {
  id: string;
  text: string;
}

export interface RerankRequest {
  query: string;
  documents: RerankDocument[];
}

export interface RerankResponse {
  results: RerankResult[];
}

export interface RerankResult {
  id: string;
  score: number;
}

export interface RerankResponse {
  results: RerankResult[];
}

export interface RerankResult {
  id: string;
  score: number;
}
