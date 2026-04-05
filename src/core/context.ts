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
    '- You are a coordinator with access to tools and delegation capabilities.',
    '- For simple operations (read file, list files, git), use direct tools.',
    '- For complex multi-step tasks requiring coordination, use the delegate tool.',
    '',
    '## Delegation Patterns (for complex tasks only)',
    '- fan-out: Execute multiple independent tasks in parallel',
    '- chain: Execute tasks sequentially, passing results forward',
    '- router: Route input to appropriate task based on content',
    '',
    '## Important Restrictions',
    '- Subagents work in isolation and cannot use the delegate tool.',
    '- Do NOT nest delegations - use direct tools in task definitions.',
    '',
    '## Response Guidelines',
    '- Use appropriate tools for the task complexity.',
    '- Provide concise, accurate responses based on tool results.',
    '- If a tool fails, report the error clearly.'
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
