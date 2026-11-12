/**
 * ADR 0056 §5 (security review): the execution-time re-check of a disclosed tool reads the sender's
 * *current* chat role and the Bot's own standing again instead of the turn-start facts.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { PermissionHost, permissionHostToken, type PermissionSenderRoles } from '@zhin.js/permission';
import { defineAgentTool, ToolIndex, toolFeatureId } from '@zhin.js/tool';
import { CapabilityIngress } from '../../src/plugin-runtime/capability-ingress.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

function fixture(permissions: readonly string[]) {
  const owner = rootPluginId();
  const run = vi.fn(() => 'done');
  const slot = createCapabilitySlot({ owner, feature: toolFeatureId, localName: 'kick', source: '/tools/kick/index.ts',
    definition: defineAgentTool({ description: 'kick a member', permissions: [...permissions], execute: run }) });
  const host = new PermissionHost();
  const base: RuntimeSnapshot = {
    generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map([[permissionHostToken.id, host]])]]) as never,
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  };
  const snapshot = { ...base, projections: new Map([[toolFeatureId, new ToolIndex([slot], base)]]) };
  return { owner, host, run, snapshot };
}

const conversation = { endpoint: { adapter: 'root/qq', id: 'qq:bot' }, kind: 'group', id: 'g1' } as const;

function turn(bot?: { standing: 'admin' | 'member' }): TurnAccessContext {
  return {
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1', conversation },
    principal: { subjectId: 'mod', roles: ['admin', 'trusted'], chatRole: 'admin', chatRoleLevels: { admin: 'conversation', trusted: 'conversation' } },
    policy: { permissions: [], unattended: false }, session: { key: 'session' },
    ...(bot ? { input: { contextState: { bot: { platform: bot } } } } : {}),
  } as never;
}

const invocation = {
  signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'session',
  origin: { kind: 'internal', source: 'test' }, principal: { subjectId: 'mod', roles: ['admin'] },
  policy: { permissions: [], unattended: false, network: { enabled: false } },
} as never;

describe('execution-time permission re-check', () => {
  it('re-reads the sender role: a role revoked mid-turn no longer runs the disclosed tool', async () => {
    const { owner, host, run, snapshot } = fixture(['admin']);
    let current: PermissionSenderRoles = { chatRole: 'admin', chatRoleLevels: { admin: 'conversation' } };
    const lookups: unknown[] = [];
    host.setSenderRoleResolver(source => { lookups.push(source); return current; });
    const { tools } = await new CapabilityIngress().read({ snapshot, owner, turn: turn() });
    expect(tools.map(tool => tool.name)).toEqual(['kick']);
    await expect(tools[0]!.execute({}, invocation)).resolves.toBe('done');
    current = {};
    await expect(tools[0]!.execute({}, invocation)).rejects.toThrow('not available in this conversation');
    expect(run).toHaveBeenCalledTimes(1);
    expect(lookups.at(-1)).toMatchObject({ conversation, endpointId: 'bot', sender: { id: 'mod' } });
  });

  it('looks the Bot standing up again instead of trusting the turn-start fact', async () => {
    const { owner, host, run, snapshot } = fixture(['bot:admin']);
    let standing: { standing: 'admin' | 'member' } | undefined = { standing: 'admin' };
    const lookups: unknown[] = [];
    host.setBotStandingResolver((_source, options) => { lookups.push(options); return standing; });
    const { tools } = await new CapabilityIngress().read({ snapshot, owner, turn: turn({ standing: 'admin' }) });
    expect(tools.map(tool => tool.name)).toEqual(['kick']);
    await expect(tools[0]!.execute({}, invocation)).resolves.toBe('done');
    // The Bot lost its admin role after the turn started.
    standing = { standing: 'member' };
    await expect(tools[0]!.execute({}, invocation)).rejects.toThrow('not available in this conversation');
    standing = undefined;
    await expect(tools[0]!.execute({}, invocation)).rejects.toThrow('not available in this conversation');
    expect(run).toHaveBeenCalledTimes(1);
    expect(lookups.every(options => !(options as { cachedOnly?: boolean }).cachedOnly)).toBe(true);
  });

  it('keeps the turn facts when no resolver is installed', async () => {
    const { owner, run, snapshot } = fixture(['admin']);
    const { tools } = await new CapabilityIngress().read({ snapshot, owner, turn: turn() });
    await expect(tools[0]!.execute({}, invocation)).resolves.toBe('done');
    expect(run).toHaveBeenCalledOnce();
  });
});
