import type {
  ConversationContext,
  ChatMessage,
  SubagentInfo,
  RetrievedChunk,
  BaseContext
} from './types';
import { buildMainAgentPrompt } from './prompts/main-agent';

export function createConversationContext(projectPath: string): ConversationContext {
  return {
    projectPath,
    indexedFiles: [],
    messages: [],
    activeSubagents: [],
    modifiedFiles: [],
  };
}

export function addMessage(
  context: ConversationContext,
  message: ChatMessage
): ConversationContext {
  return {
    ...context,
    messages: [...context.messages, message],
  };
}

export function addSystemMessage(context: ConversationContext, content: string): ConversationContext {
  return addMessage(context, { role: 'system', content });
}

export function addUserMessage(context: ConversationContext, content: string): ConversationContext {
  return addMessage(context, { role: 'user', content });
}

export function addAssistantMessage(
  context: ConversationContext,
  content: string
): ConversationContext {
  return addMessage(context, { role: 'assistant', content });
}

export function setGitBranch(context: ConversationContext, branch: string): ConversationContext {
  return { ...context, gitBranch: branch };
}

export function setIndexedFiles(
  context: ConversationContext,
  files: string[]
): ConversationContext {
  return { ...context, indexedFiles: files };
}

export function setRetrievedChunks(
  context: ConversationContext,
  chunks: RetrievedChunk[]
): ConversationContext {
  return { ...context, retrievedChunks: chunks };
}

export function addSubagent(
  context: ConversationContext,
  subagent: SubagentInfo
): ConversationContext {
  return {
    ...context,
    activeSubagents: [...context.activeSubagents, subagent],
  };
}

export function updateSubagentStatus(
  context: ConversationContext,
  subagentId: string,
  status: SubagentInfo['status']
): ConversationContext {
  return {
    ...context,
    activeSubagents: context.activeSubagents.map((sa) =>
      sa.id === subagentId ? { ...sa, status } : sa
    ),
  };
}

export function removeSubagent(
  context: ConversationContext,
  subagentId: string
): ConversationContext {
  return {
    ...context,
    activeSubagents: context.activeSubagents.filter((sa) => sa.id !== subagentId),
  };
}

export function addModifiedFile(
  context: ConversationContext,
  filePath: string
): ConversationContext {
  if (context.modifiedFiles.includes(filePath)) {
    return context;
  }
  return {
    ...context,
    modifiedFiles: [...context.modifiedFiles, filePath],
  };
}

export function buildSystemPrompt(context: ConversationContext, availableTools: string[] = []): string {
  const config = {
    projectPath: context.projectPath,
    gitBranch: context.gitBranch,
    indexedFiles: context.indexedFiles,
    availableTools,
    techStack: context.techStack,
    projectName: context.projectName,
  };

  let prompt = buildMainAgentPrompt(config);

  // Добавить retrievedChunks если есть
  if (context.retrievedChunks && context.retrievedChunks.length > 0) {
    const chunksSection = [
      '',
      '## Relevant Context from Documentation',
    ];
    
    for (const chunk of context.retrievedChunks.slice(0, 5)) {
      chunksSection.push(`### ${chunk.filePath}`, chunk.content, '');
    }
    
    prompt += '\n' + chunksSection.join('\n');
  }

  return prompt;
}

export function mergeSubagentContext(
  context: ConversationContext,
  subagentContext: Partial<BaseContext>
): ConversationContext {
  return {
    ...context,
    ...subagentContext,
    indexedFiles: subagentContext.indexedFiles ?? context.indexedFiles,
    modifiedFiles: [
      ...context.modifiedFiles,
      ...(subagentContext.indexedFiles?.filter((f) => !context.modifiedFiles.includes(f)) ?? []),
    ],
  };
}
