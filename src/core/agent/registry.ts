import type { AgentInfo } from './types';
import { BUILTIN_AGENTS } from './builtins';

class AgentRegistry {
  private agents: Map<string, AgentInfo> = new Map();

  constructor() {
    for (const agent of BUILTIN_AGENTS) {
      this.agents.set(agent.name, agent);
    }
  }

  register(agent: AgentInfo): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): AgentInfo | undefined {
    return this.agents.get(name);
  }

  list(options?: { mode?: AgentInfo['mode']; hidden?: boolean }): AgentInfo[] {
    let result = Array.from(this.agents.values());
    if (options?.hidden === false) {
      result = result.filter(a => !a.hidden);
    }
    if (options?.mode) {
      result = result.filter(a => a.mode === options.mode);
    }
    return result;
  }

  primaryAgents(): AgentInfo[] {
    return this.list({ mode: 'primary', hidden: false });
  }

  subagentAgents(): AgentInfo[] {
    return this.list({ mode: 'subagent' });
  }

  defaultAgent(): AgentInfo {
    return this.get('build')!;
  }
}

export const agentRegistry = new AgentRegistry();
