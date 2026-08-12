import { describe, expect, it } from 'vitest';
import { parseAgentToolDefinition, toolFeatureId } from '@zhin.js/tool';
import { projectHostTool } from '../../src/plugin-runtime/host-tool-projection.js';

describe('projectHostTool', () => {
  it('produces one validated ToolFeature definition without a runtime registry', async () => {
    const projected = projectHostTool({
      name: 'host_clock',
      description: 'Read the host clock',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string' } },
        required: ['timezone'],
      },
      approval: 'never',
      platforms: ['telegram'],
      execute: async (input) => `time:${String(input.timezone)}`,
    });

    expect(projected.feature).toBe(toolFeatureId);
    expect(projected.name).toBe('host_clock');
    expect(parseAgentToolDefinition(projected.definition)).toBe(projected.definition);
    expect(projected.definition.inputSchema).toEqual({
      type: 'object',
      properties: { timezone: { type: 'string' } },
      required: ['timezone'],
    });
    await expect(projected.definition.execute({ timezone: 'UTC' }, {} as never))
      .resolves.toBe('time:UTC');
  });
});
