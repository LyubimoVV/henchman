import type {
  ConversationContext,
  ChatMessage,
  SubagentInfo,
  RetrievedChunk,
  BaseContext,
} from './types';

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

export function buildSystemPrompt(context: ConversationContext): string {
  const parts: string[] = [
    'You are Henchman, an AI developer assistant with access to project context and tools.',
    '',
    '## Project Context',
    `- Project Path: ${context.projectPath}`,
    context.gitBranch ? `- Current Git Branch: ${context.gitBranch}` : '',
    context.indexedFiles.length > 0
      ? `- Indexed Files: ${context.indexedFiles.length} files`
      : '',
  ];

  if (context.retrievedChunks && context.retrievedChunks.length > 0) {
    parts.push('', '## Relevant Context from Documentation');
    for (const chunk of context.retrievedChunks.slice(0, 5)) {
      parts.push(`### ${chunk.filePath}`, chunk.content, '');
    }
  }

  parts.push(
    '',
    '## Instructions',
    '- Use available tools to gather information before answering questions.',
    '- When asked about project structure, use the list_files tool.',
    '- When asked about file contents, use the read_file tool.',
    '- When asked about git status, use git_branch and git_diff tools.',
    '- Provide concise, accurate responses based on actual project data.',
    '- If you cannot find information, say so clearly.'
  );

  return parts.filter(Boolean).join('\n');
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
