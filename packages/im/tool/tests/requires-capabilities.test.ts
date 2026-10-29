import { describe, expect, it } from 'vitest';
import { defineAgentTool, parseAgentToolDefinition } from '../src/index.js';

describe('Agent Tool requiresCapabilities (ADR 0044)', () => {
  const base = { description: 'Mute a member', requiresApproval: 'always' as const, execute: async () => 'ok' };

  it('is frozen onto the definition and survives runtime parsing', () => {
    const tool = defineAgentTool({ ...base, requiresCapabilities: ['actions.mute'] });
    expect(tool.requiresCapabilities).toEqual(['actions.mute']);
    expect(Object.isFrozen(tool.requiresCapabilities)).toBe(true);
    expect(parseAgentToolDefinition(tool).requiresCapabilities).toEqual(['actions.mute']);
  });

  it('is absent by default and rejects a malformed list', () => {
    expect(defineAgentTool(base).requiresCapabilities).toBeUndefined();
    expect(() => defineAgentTool({ ...base, requiresCapabilities: 'actions.mute' as never })).toThrow();
    expect(() => defineAgentTool({ ...base, requiresCapabilities: [''] })).toThrow();
  });
});
