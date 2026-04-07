import type { AgentInfo, PermissionAction, PermissionRule } from './agent/types';

export function evaluatePermission(
  agent: AgentInfo,
  toolName: string,
): PermissionAction {
  const rules = agent.permissions;

  let exactMatch: PermissionRule | undefined;
  let wildcardMatch: PermissionRule | undefined;

  for (const rule of rules) {
    if (rule.tool === toolName) {
      exactMatch = rule;
    }
    if (rule.tool === '*') {
      wildcardMatch = rule;
    }
  }

  if (exactMatch) {
    return exactMatch.action;
  }

  if (wildcardMatch) {
    return wildcardMatch.action;
  }

  return 'allow';
}

export function isToolAllowed(agent: AgentInfo, toolName: string): boolean {
  return evaluatePermission(agent, toolName) !== 'deny';
}

export function isToolAsk(agent: AgentInfo, toolName: string): boolean {
  return evaluatePermission(agent, toolName) === 'ask';
}

export function filterToolsByPermission<T extends { name: string }>(
  agent: AgentInfo,
  tools: T[],
): T[] {
  return tools.filter(tool => isToolAllowed(agent, tool.name));
}
