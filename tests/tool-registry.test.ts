import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/core/tool-registry';
import type { ToolDefinition } from '../src/core/types';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const mockTool: ToolDefinition = {
    name: 'test_tool',
    category: 'system',
    description: 'A test tool',
    parameters: { type: 'object' },
    execute: async () => ({ success: true, result: {} }),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register a tool', () => {
    registry.register(mockTool);
    
    expect(registry.has('test_tool')).toBe(true);
    expect(registry.getByName('test_tool')).toEqual(mockTool);
  });

  it('should register multiple tools', () => {
    const tool2: ToolDefinition = {
      ...mockTool,
      name: 'tool2',
    };
    
    registry.registerMany([mockTool, tool2]);
    
    expect(registry.getNames()).toHaveLength(2);
    expect(registry.has('test_tool')).toBe(true);
    expect(registry.has('tool2')).toBe(true);
  });

  it('should overwrite existing tool', () => {
    registry.register(mockTool);
    
    const updatedTool: ToolDefinition = {
      ...mockTool,
      description: 'Updated description',
    };
    
    registry.register(updatedTool);
    
    const retrieved = registry.getByName('test_tool');
    expect(retrieved?.description).toBe('Updated description');
  });

  it('should get tools by category', () => {
    const ragTool: ToolDefinition = {
      ...mockTool,
      name: 'rag_tool',
      category: 'rag',
    };
    
    registry.registerMany([mockTool, ragTool]);
    
    const systemTools = registry.getByCategory('system');
    const ragTools = registry.getByCategory('rag');
    
    expect(systemTools).toHaveLength(1);
    expect(ragTools).toHaveLength(1);
  });

  it('should return all tools', () => {
    const tool2: ToolDefinition = {
      ...mockTool,
      name: 'tool2',
      category: 'rag',
    };
    
    registry.registerMany([mockTool, tool2]);
    
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should return all tool descriptions', () => {
    registry.register(mockTool);
    
    const descriptions = registry.getAllDescriptions();
    
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].name).toBe('test_tool');
    expect(descriptions[0].description).toBe('A test tool');
  });

  it('should clear all tools', () => {
    registry.register(mockTool);
    registry.clear();
    
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.has('test_tool')).toBe(false);
  });

  it('should return undefined for non-existent tool', () => {
    expect(registry.getByName('non_existent')).toBeUndefined();
  });

  it('should return empty array for category with no tools', () => {
    expect(registry.getByCategory('rag')).toHaveLength(0);
  });
});
