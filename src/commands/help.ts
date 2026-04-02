import type { Orchestrator } from '../core/orchestrator';
import { retriever } from '../rag/retriever';
import { vectorStore } from '../rag/vector-store';
import { llmClient } from '../llm/client';
import pc from 'picocolors';

export async function handleHelpCommand(
  orchestrator: Orchestrator,
  query: string
): Promise<string> {
  const stats = vectorStore.stats();
  const context = orchestrator.getContext();

  if (!query || query.trim() === '') {
    return [
      pc.cyan('Henchman - AI Developer Assistant'),
      '',
      'Available commands:',
      `  ${pc.yellow('/help [query]')}  - Ask about the project (uses RAG + LLM)`,
      `  ${pc.yellow('/index')}        - Re-index project documentation`,
      `  ${pc.yellow('/tools')}        - List available tools`,
      `  ${pc.yellow('/status')}       - Show current status`,
      `  ${pc.yellow('/exit')}         - Exit the assistant`,
      '',
      'Current project:',
      `  Path: ${context.projectPath}`,
      `  Branch: ${context.gitBranch ?? 'unknown'}`,
      `  Indexed: ${stats.totalChunks} chunks from ${stats.totalFiles} files`,
      '',
      pc.gray('Tip: Just type a question without /help to chat with the AI'),
    ].join('\n');
  }

  const results = await retriever.search(query, { useRerank: false, rerankTopN: 5 });

  if (results.length === 0) {
    return pc.yellow('No relevant documentation found. Try /index to re-index the project.');
  }

  const contextText = results
    .map((r) => `[${r.filePath}]:\n${r.content}`)
    .join('\n\n');

  const systemPrompt = `You are a helpful assistant answering questions about a project.
Use the following context from the project documentation to answer the user's question.
Be concise and accurate. Answer in the same language as the question.

## Project Context:
${contextText}`;

  try {
    const response = await llmClient.chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.7,
      maxTokens: 1024,
    });

    return response.content ?? pc.yellow('No response from LLM');
  } catch (error) {
    const fallbackLines: string[] = [pc.cyan(`Results for: "${query}"`), ''];

    for (const result of results.slice(0, 3)) {
      fallbackLines.push(pc.green(`📄 ${result.filePath} (score: ${result.score.toFixed(3)})`));
      fallbackLines.push(pc.gray(`   Lines ${result.metadata.startLine}-${result.metadata.endLine}`));
      fallbackLines.push(result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''));
      fallbackLines.push('');
    }

    fallbackLines.push(pc.red(`LLM Error: ${(error as Error).message}`));
    return fallbackLines.join('\n');
  }
}
