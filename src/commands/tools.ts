import type { Orchestrator } from '../core/orchestrator';
import pc from 'picocolors';

export function handleToolsCommand(orchestrator: Orchestrator): string {
  const orchestratorTools = orchestrator.getTools();
  const subagentTools = orchestrator.getSubagentTools();

  const lines: string[] = [pc.cyan('Available Tools'), ''];

  lines.push(pc.yellow('Orchestrator Tools (for LLM):'));
  for (const tool of orchestratorTools) {
    lines.push(`  ${pc.green(tool.name)} - ${tool.description.substring(0, 80)}...`);
  }

  lines.push('');
  lines.push(pc.yellow('Subagent Tools (via delegate):'));
  
  const grouped = {
    system: subagentTools.filter((t) => t.category === 'system'),
    mcp: subagentTools.filter((t) => t.category === 'mcp'),
    rag: subagentTools.filter((t) => t.category === 'rag'),
  };

  if (grouped.system.length > 0) {
    lines.push(pc.gray('  System:'));
    for (const tool of grouped.system) {
      lines.push(`    ${pc.green(tool.name)}`);
    }
  }

  if (grouped.mcp.length > 0) {
    lines.push(pc.gray('  MCP:'));
    for (const tool of grouped.mcp) {
      lines.push(`    ${pc.green(tool.name)}`);
    }
  }

  if (grouped.rag.length > 0) {
    lines.push(pc.gray('  RAG:'));
    for (const tool of grouped.rag) {
      lines.push(`    ${pc.green(tool.name)}`);
    }
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
