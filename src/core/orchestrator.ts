import type {
  ConversationContext,
  ChatMessage,
  ToolDefinition,
  SubagentContext,
  RetrievedChunk,
} from './types';
import { createConversationContext, buildSystemPrompt, addUserMessage, addAssistantMessage, setGitBranch, setRetrievedChunks, setIndexedFiles, mergeSubagentContext, addSubagent, updateSubagentStatus, removeSubagent } from './context';
import { toolRegistry } from './tool-registry';
import { toolExecutor } from './tool-executor';
import { toolUseLoop } from './tool-use-loop';
import { createSubagent } from './subagent';
import { logger } from './logger';
import { retriever } from '../rag/retriever';
import { indexer } from '../rag/indexer';
import { vectorStore } from '../rag/vector-store';
import { createMcpTools } from '../tools/mcp';
import { systemTools } from '../tools/system';
import { ragTools, setCurrentProjectPath } from '../tools/rag';

export interface OrchestratorOptions {
  projectPath: string;
  autoIndex?: boolean;
}

export class Orchestrator {
  private context: ConversationContext;
  private allTools: ToolDefinition[];

  constructor(options: OrchestratorOptions) {
    this.context = createConversationContext(options.projectPath);
    this.allTools = [];

    this.initializeTools(options.projectPath);

    if (options.autoIndex !== false) {
      this.autoIndexProject(options.projectPath);
    }
  }

  private initializeTools(projectPath: string): void {
    setCurrentProjectPath(projectPath);

    const mcpTools = createMcpTools(projectPath);

    this.allTools = [
      ...systemTools,
      ...mcpTools,
      ...ragTools,
    ];

    toolRegistry.registerMany(this.allTools);
    logger.info('main', `Registered ${this.allTools.length} tools`);
  }

  private async autoIndexProject(projectPath: string): Promise<void> {
    logger.info('main', 'Auto-indexing project...');

    try {
      const gitBranchTool = this.allTools.find((t) => t.name === 'git_branch');
      if (gitBranchTool) {
        const result = await toolExecutor.execute('git_branch', {});
        if (result.success && result.result) {
          const branch = (result.result as { branch: string }).branch;
          this.context = setGitBranch(this.context, branch);
        }
      }
    } catch (error) {
      logger.debug('main', 'Could not get git branch', { error: (error as Error).message });
    }

    try {
      const indexResult = await indexer.indexProject(projectPath);
      this.context = setIndexedFiles(this.context, vectorStore.getIndexedFiles());
      logger.info('main', 'Project indexed', {
        files: indexResult.filesProcessed,
        chunks: indexResult.chunksCreated,
      });
    } catch (error) {
      logger.warn('main', 'Auto-indexing failed', { error: (error as Error).message });
    }
  }

  async handleMessage(userMessage: string): Promise<string> {
    logger.info('main', `Processing message: ${userMessage.substring(0, 50)}...`);

    const relevantChunks = await this.getRelevantContext(userMessage);
    if (relevantChunks.length > 0) {
      this.context = setRetrievedChunks(this.context, relevantChunks);
    }

    this.context = addUserMessage(this.context, userMessage);

    const systemPrompt = buildSystemPrompt(this.context);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.context.messages,
    ];

    const result = await toolUseLoop(messages, {
      maxIterations: 10,
      tools: this.allTools,
      onToolCall: (name, args) => {
        logger.toolCall(name, args);
      },
      onToolResult: (name, _result, success) => {
        logger.toolResult(name, success);
      },
    });

    if (result.finalContent) {
      this.context = addAssistantMessage(this.context, result.finalContent);
    }

    return result.finalContent || 'I was unable to generate a response. Please try again.';
  }

  private async getRelevantContext(query: string): Promise<RetrievedChunk[]> {
    if (vectorStore.stats().totalChunks === 0) {
      return [];
    }

    try {
      const chunks = await retriever.search(query, { rerankTopN: 3 });
      return chunks;
    } catch (error) {
      logger.debug('main', 'Failed to retrieve context', { error: (error as Error).message });
      return [];
    }
  }

  async spawnSubagent(
    task: string,
    toolNames: string[]
  ): Promise<{ subagentId: string; result: unknown }> {
    const subagentId = `subagent_${Date.now()}`;

    this.context = addSubagent(this.context, {
      id: subagentId,
      task,
      status: 'spawning',
    });

    const subagentTools = toolNames
      .map((name) => toolRegistry.getByName(name))
      .filter((t): t is ToolDefinition => t !== undefined);

    const subagentContext: SubagentContext = {
      projectPath: this.context.projectPath,
      gitBranch: this.context.gitBranch,
      indexedFiles: this.context.indexedFiles,
      taskId: subagentId,
      taskDescription: task,
      parentAgentId: 'main',
      allowedTools: toolNames,
    };

    const subagent = createSubagent(task, subagentTools, subagentContext);

    this.context = updateSubagentStatus(this.context, subagentId, 'executing');

    const result = await subagent.execute();

    this.context = updateSubagentStatus(this.context, subagentId, result.status === 'success' ? 'completed' : 'failed');
    this.context = mergeSubagentContext(this.context, result.contextOut);
    this.context = removeSubagent(this.context, subagentId);

    return { subagentId, result };
  }

  getContext(): ConversationContext {
    return this.context;
  }

  getTools(): ToolDefinition[] {
    return this.allTools;
  }

  async reindexProject(): Promise<{ files: number; chunks: number }> {
    vectorStore.clear();
    const result = await indexer.indexProject(this.context.projectPath);
    this.context = setIndexedFiles(this.context, vectorStore.getIndexedFiles());
    return { files: result.filesProcessed, chunks: result.chunksCreated };
  }
}
