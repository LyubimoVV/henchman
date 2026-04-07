export type AgentMode = 'primary' | 'subagent' | 'utility';

export type PermissionAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  tool: string;
  action: PermissionAction;
}

export interface AgentInfo {
  name: string;
  description: string;
  mode: AgentMode;
  hidden?: boolean;
  prompt?: string;
  temperature?: number;
  maxIterations?: number;
  permissions: PermissionRule[];
  model?: { modelId: string; providerId: string };
}
