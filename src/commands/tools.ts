import type { Orchestrator } from '../core/orchestrator';
import pc from 'picocolors';

export function handleToolsCommand(orchestrator: Orchestrator): string {
  const tools = orchestrator.getTools();
  const grouped = {
    system: tools.filter((t) => t.category === 'system'),
    mcp: tools.filter((t) => t.category === 'mcp'),
    rag: tools.filter((t) => t.category === 'rag'),
  };

  const lines: string[] = [pc.cyan('Available Tools'), ''];

  lines.push(pc.yellow('System Tools:'));
  for (const tool of grouped.system) {
    lines.push(`  ${pc.green(tool.name)} - ${tool.description.substring(0, 60)}...`);
  }

  lines.push('');
  lines.push(pc.yellow('MCP Tools:'));
  for (const tool of grouped.mcp) {
    lines.push(`  ${pc.green(tool.name)} - ${tool.description.substring(0, 60)}...`);
  }

  lines.push('');
  lines.push(pc.yellow('RAG Tools:'));
  for (const tool of grouped.rag) {
    lines.push(`  ${pc.green(tool.name)} - ${tool.description.substring(0, 60)}...`);
  }

  return lines.join('\n');
}

export function handleStatusCommand(orchestrator: Orchestrator): string {
  const context = orchestrator.getContext();
  const stats = { totalChunks: 0, totalFiles: 0 };
  
  try {
    const { vectorStore } = require('../rag/vector-store');
    Object.assign(stats, vectorStore.stats());
  } catch {
    // VectorStore not available
  }

  const lines: string[] = [
    pc.cyan('Henchman Status'),
    '',
    `Project: ${context.projectPath}`,
    `Git Branch: ${context.gitBranch ?? 'unknown'}`,
    `Messages: ${context.messages.length}`,
    `Indexed Files: ${stats.totalFiles}`,
    `Indexed Chunks: ${stats.totalChunks}`,
    `Active Subagents: ${context.activeSubagents.length}`,
  ];

  return lines.join('\n');
}

export function handleExitCommand(): string {
  return pc.cyan('Goodbye! 👋');
}
