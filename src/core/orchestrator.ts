import type {
  ConversationContext,
  ChatMessage,
  ToolDefinition,
  SubagentContext,
} from './types';
import type { DelegationPattern, FanOutConfig, ChainConfig, RouterConfig } from './delegation/types';
import type { AgentInfo } from './agent/types';
import type { Session } from './session/types';
import { createConversationContext, buildSystemPrompt, addUserMessage, addAssistantMessage, setGitBranch, setIndexedFiles, mergeSubagentContext, addSubagent, updateSubagentStatus, removeSubagent } from './context';
import { toolRegistry } from './tool-registry';
import { toolUseLoop, type ToolUseLoopOptions } from './tool-use-loop';
import { createSubagent } from './subagent';
import { DelegationManager } from './delegation/manager';
import { agentRegistry } from './agent/registry';
import { filterToolsByPermission } from './permission';
import { sessionStore } from './session/store';
import { logger } from './logger';
import { indexer } from '../rag/indexer';
import { vectorStore } from '../rag/vector-store';
import { createMcpTools } from '../tools/mcp';
import { systemTools, createDelegateTool, createQuestionTool } from '../tools/system';
import { ragTools, setCurrentProjectPath } from '../tools/rag';

export interface OrchestratorOptions {
  projectPath: string;
  autoIndex?: boolean;
  onContent?: (content: string) => void;
  onPermissionAsk?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export class Orchestrator {
  private context: ConversationContext;
  private orchestratorTools: ToolDefinition[];
  private subagentTools: ToolDefinition[];
  private delegationManager: DelegationManager;
  private currentAgent: AgentInfo;
  private session: Session;
  private abortController: AbortController;
  private onContent?: (content: string) => void;
  private onPermissionAsk?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

  constructor(options: OrchestratorOptions) {
    this.context = createConversationContext(options.projectPath);
    this.orchestratorTools = [];
    this.subagentTools = [];
    this.currentAgent = agentRegistry.defaultAgent();
    this.abortController = new AbortController();
    this.onContent = options.onContent;
    this.onPermissionAsk = options.onPermissionAsk;

    this.session = sessionStore.create({ agentName: this.currentAgent.name });

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

    const questionTool = createQuestionTool({
      askUser: async (questions) => {
        if (this.onPermissionAsk) {
          const answers: string[] = [];
          for (const q of questions) {
            const approved = await this.onPermissionAsk(q.header, { question: q.question });
            answers.push(approved ? 'yes' : 'no');
          }
          return answers;
        }
        return questions.map(() => 'yes');
      },
    });

    const allTools: ToolDefinition[] = [
      ...systemTools,
      delegateTool,
      questionTool,
      ...mcpTools,
      ...ragTools,
    ];

    this.subagentTools = allTools.filter(
      t => !['delegate'].includes(t.name),
    );
    this.orchestratorTools = this.resolveOrchestratorTools();

    this.delegationManager.updateOptions({ subagentTools: this.subagentTools });

    toolRegistry.registerMany(allTools);
    logger.info('main', `Registered tools: ${this.orchestratorTools.length} for orchestrator, ${this.subagentTools.length} for subagents`);
  }

  private resolveOrchestratorTools(): ToolDefinition[] {
    const delegateTool = toolRegistry.getByName('delegate');
    const questionTool = toolRegistry.getByName('question');
    const tools: ToolDefinition[] = [];
    if (delegateTool) tools.push(delegateTool);
    if (questionTool) tools.push(questionTool);
    return tools;
  }

  switchAgent(agentName: string): boolean {
    const agent = agentRegistry.get(agentName);
    if (!agent || agent.mode !== 'primary') return false;
    this.currentAgent = agent;
    this.orchestratorTools = this.resolveOrchestratorTools();
    this.session = sessionStore.create({ agentName: agent.name });
    this.abortController = new AbortController();
    logger.info('main', `Switched to agent: ${agentName}`, { toolsCount: this.orchestratorTools.length });
    return true;
  }

  getCurrentAgent(): AgentInfo {
    return this.currentAgent;
  }

  cancel(): void {
    this.abortController.abort();
    sessionStore.setStatus(this.session.id, 'cancelled');
    logger.info('main', 'Execution cancelled');
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

    this.abortController = new AbortController();
    sessionStore.setStatus(this.session.id, 'active');

    this.context = addUserMessage(this.context, userMessage);
    sessionStore.addMessage(this.session.id, { role: 'user', content: userMessage });

    const systemPrompt = buildSystemPrompt(
      this.context,
      this.orchestratorTools.map(t => t.name),
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.context.messages,
    ];

    const loopOptions: ToolUseLoopOptions = {
      maxIterations: this.currentAgent.maxIterations ?? 15,
      tools: this.orchestratorTools,
      agent: this.currentAgent,
      signal: this.abortController.signal,
      onContent: this.onContent,
      onPermissionAsk: this.onPermissionAsk,
    };

    const result = await toolUseLoop(messages, loopOptions);

    if (result.finalContent) {
      this.context = addAssistantMessage(this.context, result.finalContent);
      sessionStore.addMessage(this.session.id, { role: 'assistant', content: result.finalContent });
    }

    sessionStore.setStatus(this.session.id, 'completed');

    return result.finalContent || 'I was unable to generate a response. Please try again.';
  }

  async spawnSubagent(
    task: string,
    toolNames: string[],
    agentName?: string,
  ): Promise<{ subagentId: string; result: unknown }> {
    const subagentId = `subagent_${Date.now()}`;
    const agent = agentName
      ? agentRegistry.get(agentName)
      : agentRegistry.get('general');

    this.context = addSubagent(this.context, {
      id: subagentId,
      task,
      status: 'spawning',
    });

    const resolvedToolNames = agent
      ? filterToolsByPermission(agent, this.subagentTools).map(t => t.name)
      : toolNames;

    const subagentTools = (agent
      ? filterToolsByPermission(agent, this.subagentTools)
      : toolNames
        .map((name) => toolRegistry.getByName(name))
        .filter((t): t is ToolDefinition => t !== undefined)
    );

    const childSession = sessionStore.create({
      agentName: agent?.name ?? 'general',
      parentId: this.session.id,
    });

    const subagentContext: SubagentContext = {
      projectPath: this.context.projectPath,
      gitBranch: this.context.gitBranch,
      indexedFiles: this.context.indexedFiles,
      taskId: subagentId,
      taskDescription: task,
      parentAgentId: this.session.id,
      allowedTools: resolvedToolNames,
    };

    const subagent = createSubagent(task, subagentTools, subagentContext, {
      agent,
      signal: this.abortController.signal,
    });

    this.context = updateSubagentStatus(this.context, subagentId, 'executing');

    const result = await subagent.execute();

    sessionStore.addMessage(childSession.id, { role: 'assistant', content: String(result.data ?? '') });
    sessionStore.setStatus(childSession.id, result.status === 'success' ? 'completed' : 'cancelled');

    this.context = updateSubagentStatus(this.context, subagentId, result.status === 'success' ? 'completed' : 'failed');
    this.context = mergeSubagentContext(this.context, result.contextOut);
    this.context = removeSubagent(this.context, subagentId);

    return { subagentId, result };
  }

  getContext(): ConversationContext {
    return this.context;
  }

  getSession(): Session {
    return this.session;
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

  async handleMessageWithPlan(goal: string): Promise<string> {
    logger.info('main', `Planned execution: ${goal.substring(0, 80)}...`);

    this.abortController = new AbortController();

    try {
      const result = await this.delegationManager.executeWithPlan(goal);

      if (result.status === 'success' || result.status === 'partial') {
        const summary = result.data
          .filter((d): d is string => typeof d === 'string')
          .join('\n\n');
        return summary || 'Task completed with no output.';
      }

      return 'Task failed. Please try rephrasing your request.';
    } catch (error) {
      logger.error('main', 'Planned execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return `Error during execution: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
