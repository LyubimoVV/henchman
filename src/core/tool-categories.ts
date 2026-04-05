import type { ToolDefinition } from './types';

export const ORCHESTRATOR_TOOLS = ['delegate'] as const;

export type OrchestratorToolName = typeof ORCHESTRATOR_TOOLS[number];

export function categorizeTools(
  allTools: ToolDefinition[]
): {
  orchestratorTools: ToolDefinition[];
  subagentTools: ToolDefinition[];
} {
  return {
    orchestratorTools: allTools.filter((t) =>
      (ORCHESTRATOR_TOOLS as readonly string[]).includes(t.name)
    ),
    subagentTools: allTools.filter(
      (t) => !(ORCHESTRATOR_TOOLS as readonly string[]).includes(t.name)
    ),
  };
}
