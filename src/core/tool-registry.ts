import type { ToolDefinition, JSONSchema } from './types';
import { logger } from './logger';

export interface ToolDescription {
  name: string;
  description: string;
  parameters: JSONSchema;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.debug('system', `Tool "${tool.name}" already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    logger.debug('system', `Registered tool: ${tool.name}`, { category: tool.category });
  }

  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  getByName(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) => tool.category === category);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getAllDescriptions(): ToolDescription[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  clear(): void {
    this.tools.clear();
    logger.debug('system', 'Tool registry cleared');
  }
}

export const toolRegistry = new ToolRegistry();
export { ToolRegistry };
