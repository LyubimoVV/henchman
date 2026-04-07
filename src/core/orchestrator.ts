import type {
  ConversationContext,
  ChatMessage,
  ToolDefinition,
  SubagentContext,
} from './types';
import type { DelegationPattern, FanOutConfig, ChainConfig, RouterConfig } from './delegation/types';
import { createConversationContext, buildSystemPrompt, addUserMessage, addAssistantMessage, setGitBranch, setIndexedFiles, mergeSubagentContext, addSubagent, updateSubagentStatus, removeSubagent } from './context';
import { toolRegistry } from './tool-registry';
import { toolUseLoop } from './tool-use-loop';
import { createSubagent } from './subagent';
import { DelegationManager } from './delegation/manager';
import { categorizeTools } from './tool-categories';
import { logger } from './logger';
import { indexer } from '../rag/indexer';
import { vectorStore } from '../rag/vector-store';
import { createMcpTools } from '../tools/mcp';
import { systemTools, createDelegateTool } from '../tools/system';
import { ragTools, setCurrentProjectPath } from '../tools/rag';

export interface OrchestratorOptions {
  projectPath: string;
  autoIndex?: boolean;
}

export class Orchestrator {
  private context: ConversationContext;
  private orchestratorTools: ToolDefinition[];
  private subagentTools: ToolDefinition[];
  private delegationManager: DelegationManager;

  constructor(options: OrchestratorOptions) {
    this.context = createConversationContext(options.projectPath);
    this.orchestratorTools = [];
    this.subagentTools = [];

    this.delegationManager = new DelegationManager({
      projectPath: options.projectPath,
      indexedFiles: [],
      subagentTools: [],
    });

    this.initializeTools(options.projectPath);

    if (options.autoIndex !== false) {
      this.autoIndexProject(options.projectPath);
    }
  }

  private initializeTools(projectPath: string): void {
    setCurrentProjectPath(projectPath);

    const mcpTools = createMcpTools(projectPath);

    const delegateTool = createDelegateTool({
      executeDelegation: async (pattern, config) => {
        return this.delegationManager.execute(pattern, config);
      },
    });

    const allTools: ToolDefinition[] = [
      ...systemTools,
      delegateTool,
      ...mcpTools,
      ...ragTools,
    ];

    const { orchestratorTools, subagentTools } = categorizeTools(allTools);
    
    this.orchestratorTools = orchestratorTools;
    this.subagentTools = subagentTools;

    this.delegationManager.updateOptions({ subagentTools: this.subagentTools });

    toolRegistry.registerMany(allTools);
    logger.info('main', `Registered tools: ${orchestratorTools.length} for orchestrator, ${subagentTools.length} for subagents`);
  }

  private async autoIndexProject(projectPath: string): Promise<void> {
    logger.info('main', 'Auto-indexing project...', { projectPath });

    try {
      const gitBranchTool = this.subagentTools.find((t: ToolDefinition) => t.name === 'git_branch');
      if (gitBranchTool) {
        const result = await gitBranchTool.execute({});
        if (result.success && result.result) {
          const branch = (result.result as { branch: string }).branch;
          this.context = setGitBranch(this.context, branch);
          this.delegationManager.updateOptions({ gitBranch: branch });
          logger.info('main', `Git branch detected: ${branch}`);
        } else {
          logger.debug('main', 'Could not get git branch', { 
            success: result.success, 
            hasResult: !!result.result 
          });
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

    // RAG отключен по умолчанию - LLM использует RAG tools когда нужно
    // Автоматический RAG только в /help команде

    this.context = addUserMessage(this.context, userMessage);

    const systemPrompt = buildSystemPrompt(
      this.context,
      this.orchestratorTools.map(t => t.name),
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.context.messages,
    ];

    const result = await toolUseLoop(messages, {
      maxIterations: 15,
      tools: this.orchestratorTools,
    });

    if (result.finalContent) {
      this.context = addAssistantMessage(this.context, result.finalContent);
    }

    return result.finalContent || 'I was unable to generate a response. Please try again.';
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
    return this.orchestratorTools;
  }

  getSubagentTools(): ToolDefinition[] {
    return this.subagentTools;
  }

  async reindexProject(): Promise<{ files: number; chunks: number }> {
    vectorStore.clear();
    const result = await indexer.indexProject(this.context.projectPath);
    this.context = setIndexedFiles(this.context, vectorStore.getIndexedFiles());
    
    this.delegationManager.updateOptions({
      indexedFiles: this.context.indexedFiles,
    });
    
    return { files: result.filesProcessed, chunks: result.chunksCreated };
  }

  async fanOut(config: FanOutConfig) {
    return this.delegationManager.execute('fan-out', config);
  }

  async chain(config: ChainConfig) {
    return this.delegationManager.execute('chain', config);
  }

  async route(config: RouterConfig) {
    return this.delegationManager.execute('router', config);
  }

  async delegate(
    pattern: DelegationPattern,
    config: FanOutConfig | ChainConfig | RouterConfig
  ) {
    return this.delegationManager.execute(pattern, config);
  }
}
