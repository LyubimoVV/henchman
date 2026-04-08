import type { AgentInfo } from './types';

export const BUILD_AGENT: AgentInfo = {
  name: 'build',
  description: 'Default full-access agent for development work',
  mode: 'primary',
  permissions: [{ tool: '*', action: 'allow' }],
  maxIterations: 15,
  temperature: 0.7,
};

export const PLAN_AGENT: AgentInfo = {
  name: 'plan',
  description: 'Read-only agent for analysis and code exploration',
  mode: 'primary',
  permissions: [
    { tool: 'delegate', action: 'allow' },
    { tool: 'glob_search', action: 'allow' },
    { tool: 'content_search', action: 'allow' },
    { tool: 'rag_search', action: 'allow' },
    { tool: 'file_read', action: 'allow' },
    { tool: 'read_file', action: 'allow' },
    { tool: 'list_files', action: 'allow' },
    { tool: 'find_files', action: 'allow' },
    { tool: 'bash', action: 'ask' },
    { tool: 'file_write', action: 'deny' },
    { tool: 'edit_file', action: 'deny' },
  ],
  maxIterations: 5,
  temperature: 0.7,
};

export const EXPLORE_SUBAGENT: AgentInfo = {
  name: 'explore',
  description: 'Fast subagent for codebase exploration (read-only)',
  mode: 'subagent',
  permissions: [
    { tool: 'delegate', action: 'deny' },
    { tool: 'file_write', action: 'deny' },
    { tool: 'bash', action: 'deny' },
  ],
  maxIterations: 8,
  temperature: 0.3,
};

export const GENERAL_SUBAGENT: AgentInfo = {
  name: 'general',
  description: 'Multi-step subagent for complex research and tasks',
  mode: 'subagent',
  permissions: [
    { tool: 'delegate', action: 'deny' },
    { tool: 'file_write', action: 'allow' },
  ],
  maxIterations: 20,
  temperature: 0.7,
};

export const COMPACTION_AGENT: AgentInfo = {
  name: 'compaction',
  description: 'Context window compaction when overflowing',
  mode: 'utility',
  hidden: true,
  permissions: [{ tool: '*', action: 'deny' }],
  maxIterations: 1,
  temperature: 0.3,
};

export const TITLE_AGENT: AgentInfo = {
  name: 'title',
  description: 'Auto-generate session titles',
  mode: 'utility',
  hidden: true,
  permissions: [{ tool: '*', action: 'deny' }],
  maxIterations: 1,
  temperature: 0.5,
};

export const BUILTIN_AGENTS: AgentInfo[] = [
  BUILD_AGENT,
  PLAN_AGENT,
  EXPLORE_SUBAGENT,
  GENERAL_SUBAGENT,
  COMPACTION_AGENT,
  TITLE_AGENT,
];
