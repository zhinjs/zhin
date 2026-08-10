import { describe, expect, it } from 'vitest';
import { ToolSystem, createDefaultToolSources } from '../../src/tool/tool-system.js';
import { DedupeToolFilter, ExternalToolSource, RegisteredToolSource } from '../../src/tool/sources.js';
import type { RegisteredAgentTool } from '../../src/tool/contracts.js';
import type { AgentTool } from '@zhin.js/ai';
import { createSyntheticMessage } from '@zhin.js/core';
import { createPermissionHost } from '@zhin.js/permission';
import type { Tool } from '../../src/orchestrator/types.js';

describe('ToolSystem', () => {
  it('dedupes tools by name when collecting', async () => {
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

    const collected = await system.collectTools({
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

  it('uses canonical role/platform permit semantics for external Runtime tools', async () => {
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
      permissionHost: createPermissionHost(),
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

    expect(await source.collectTools({ ...base, message: trusted })).toHaveLength(1);
    expect(await source.collectTools({ ...base, message: user })).toHaveLength(0);
  });

  describe('RegisteredToolSource', () => {
    const base = {
      content: '',
      sessionId: 's1',
      userId: 'u1',
      config: {} as never,
      skillRegistry: null,
      externalTools: [],
      imTranscriptStore: {} as never,
      userProfiles: {} as never,
      permissionHost: createPermissionHost(),
    };
    const trustedGroup = createSyntheticMessage({
      adapter: 'qq',
      endpoint: 'bot',
      sender: { id: 'u1', isTrusted: true },
      channel: { type: 'group', id: 'g1' },
    });
    const plainGroup = createSyntheticMessage({
      adapter: 'qq',
      endpoint: 'bot',
      sender: { id: 'u2' },
      channel: { type: 'group', id: 'g1' },
    });

    function sourceOf(...tools: RegisteredAgentTool[]): RegisteredToolSource {
      return new RegisteredToolSource(new Map(tools.map((tool) => [tool.name, tool])));
    }

    function tool(partial: Partial<RegisteredAgentTool> & { name: string }): RegisteredAgentTool {
      return {
        description: 'd',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'ok',
        ...partial,
      };
    }

    it('keeps unconstrained registered tools for every message', async () => {
      const source = sourceOf(tool({ name: 'echo' }));
      expect(await source.collectTools({ ...base, message: plainGroup })).toHaveLength(1);
    });

    it('drops hidden registered tools from the turn catalog', async () => {
      const source = sourceOf(tool({ name: 'secret', hidden: true }));
      expect(await source.collectTools({ ...base, message: trustedGroup })).toHaveLength(0);
    });

    it('applies the same canAccessTool permit semantics as external tools', async () => {
      const source = sourceOf(tool({ name: 'moderate', permissions: ['role(trusted)'] }));
      expect(await source.collectTools({ ...base, message: trustedGroup })).toHaveLength(1);
      expect(await source.collectTools({ ...base, message: plainGroup })).toHaveLength(0);
    });

    it('enforces platforms and scopes against the turn message', async () => {
      const source = sourceOf(
        tool({ name: 'qq_only', platforms: ['qq'] }),
        tool({ name: 'discord_only', platforms: ['discord'] }),
        tool({ name: 'private_only', scopes: ['private'] }),
      );
      const names = (await source
        .collectTools({ ...base, message: plainGroup }))
        .map((t) => t.name);
      expect(names).toEqual(['qq_only']);
    });

    it('drops constrained tools when no message context is available', async () => {
      const source = sourceOf(
        tool({ name: 'echo' }),
        tool({ name: 'scoped', scopes: ['group'] }),
      );
      const names = (await source
        .collectTools({ ...base, message: undefined as never }))
        .map((t) => t.name);
      expect(names).toEqual(['echo']);
    });
  });
});
