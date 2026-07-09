import { describe, expect, it } from 'vitest';
import { ToolSystem, createDefaultToolSources } from '../../src/tool/tool-system.js';
import { DedupeToolFilter } from '../../src/tool/sources.js';
import type { AgentTool } from '@zhin.js/ai';

describe('ToolSystem', () => {
  it('dedupes tools by name when collecting', () => {
    const system = new ToolSystem();
    system.addFilter(new DedupeToolFilter());
    const tool: AgentTool = {
      name: 'dup_tool',
      description: 'a',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    };
    system.addSource({
      name: 'test',
      priority: 1,
      collectTools: () => [tool, { ...tool, description: 'b' }],
    });

    const collected = system.collectTools({
      message: { $sender: { id: 'u1' } } as any,
      externalTools: [],
      skillRegistry: null,
      externalRegistered: new Map(),
    });

    expect(collected.filter((t) => t.name === 'dup_tool')).toHaveLength(1);
  });

  it('concurrent collectForTurn does not mutate shared instance state', async () => {
    const system = new ToolSystem();
    const ctx = {
      message: { $sender: { id: 'u1' } } as any,
      content: 'hi',
      sessionId: 's1',
      userId: 'u1',
      config: {} as any,
      skillRegistry: null,
      externalTools: [],
      externalRegistered: new Map(),
      imTranscriptStore: {} as any,
      userProfiles: {} as any,
    };
    const host = {
      subagentSystem: null,
      activeBinding: null,
    } as any;

    const [a, b] = await Promise.all([
      Promise.resolve(system.collectForTurn({ ...ctx, host })),
      Promise.resolve(system.collectForTurn({ ...ctx, host })),
    ]);
    expect(a).toEqual(b);
    expect(createDefaultToolSources(ctx)).toHaveLength(5);
  });
});
