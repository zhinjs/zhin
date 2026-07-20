import { describe, expect, it } from 'vitest';
import { ToolSystem, createDefaultToolSources } from '../../src/tool/tool-system.js';
import { DedupeToolFilter, ExternalToolSource } from '../../src/tool/sources.js';
import type { AgentTool } from '@zhin.js/ai';
import { createSyntheticMessage } from '@zhin.js/core';
import type { Tool } from '../../src/orchestrator/types.js';

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

  it('uses canonical role/platform permit semantics for external Runtime tools', () => {
    const tool: Tool = {
      name: 'moderate',
      description: 'Moderate a group',
      parameters: { type: 'object', properties: {} },
      permissions: ['role(trusted)'],
      execute: async () => 'ok',
    };
    const source = new ExternalToolSource([tool]);
    const base = {
      content: '',
      sessionId: 's1',
      userId: 'u1',
      config: {} as never,
      skillRegistry: null,
      externalRegistered: new Map(),
      imTranscriptStore: {} as never,
      userProfiles: {} as never,
    };
    const trusted = createSyntheticMessage({
      adapter: 'qq',
      endpoint: 'bot',
      sender: { id: 'u1', isTrusted: true },
      channel: { type: 'group', id: 'g1' },
    });
    const user = createSyntheticMessage({
      adapter: 'qq',
      endpoint: 'bot',
      sender: { id: 'u2' },
      channel: { type: 'group', id: 'g1' },
    });

    expect(source.collectTools({ ...base, message: trusted })).toHaveLength(1);
    expect(source.collectTools({ ...base, message: user })).toHaveLength(0);
  });
});
