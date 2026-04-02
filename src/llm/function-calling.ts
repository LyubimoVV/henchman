import type { ToolDefinition, JSONSchema } from '../core/types';
import type { ToolDescription } from './client';

export function buildToolSchemas(tools: ToolDefinition[]): ToolDescription[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: schemaToJsonSchema(tool.parameters),
    },
  }));
}

function schemaToJsonSchema(schema: JSONSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: schema.type,
  };

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, schemaToJsonSchema(value)])
    );
  }

  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.items) {
    result.items = schemaToJsonSchema(schema.items);
  }

  if (schema.enum) {
    result.enum = schema.enum;
  }

  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  return result;
}

export function createSimpleToolSchema(
  properties: Record<string, { type: string; description: string }>,
  required: string[] = []
): JSONSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        { type: value.type, description: value.description },
      ])
    ),
    required,
  };
}
