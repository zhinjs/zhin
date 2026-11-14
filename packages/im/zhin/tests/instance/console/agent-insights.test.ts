import { describe, expect, it } from 'vitest';
import { projectAgentBindings, projectRecentTurns } from '../../../src/instance/console/agent-insights.js';
import { createProviderDisplayIndex } from '../../../src/instance/inference/provider-display.js';
import { AgentConfigProjection } from '../../../src/instance/console/agent-config-projection.js';
import { createAgentRuntimeLeaseResolver } from '../../../src/instance/console/agent-runtime-resolver.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SVC = 'services:11111111-1111-4111-8111-111111111111';
const ACC = 'accounts:22222222-2222-4222-8222-222222222222';
const resource = { rootId: '/p', ownerId: 'o', revision: 1 };
const graph = {
  rootId: '/p', revision: 1,
  services: { [SVC]: { id: SVC, ...resource, label: 'AG 中转', driver: { id: 'openai-compatible', owner: 'x', contractVersion: '1' }, options: {}, models: {} } },
  accounts: { [ACC]: { id: ACC, ...resource, serviceId: SVC, incarnation: 'i', authentication: { method: 'none' } } },
  profiles: {
    'profiles:chat': { id: 'profiles:chat', ...resource, accountId: ACC, model: 'ag/gemini-3.8-flash', parameters: {} },
    'profiles:writer': { id: 'profiles:writer', ...resource, label: '写手', accountId: ACC, model: 'ag/claude-x', parameters: {} },
  },
  purposes: { defaults: { chat: 'profiles:chat' }, agents: { writer: 'profiles:writer' } },
} as never;

describe('provider display index (#1250)', () => {
  it('maps services, accounts and profiles to one service and names the effective agent profile', () => {
    const index = createProviderDisplayIndex(graph);
    expect(index.resolveProvider(SVC)).toEqual({ key: SVC, label: 'AG 中转' });
    expect(index.resolveProvider(ACC)).toEqual({ key: SVC, label: 'AG 中转' });
    expect(index.resolveProvider('profiles:chat')).toEqual({ key: SVC, label: 'AG 中转' });
    expect(index.resolveProvider('openai')).toBeUndefined();
    expect(index.agentProfile('zhin')).toMatchObject({ purpose: 'chat', model: 'ag/gemini-3.8-flash', displayName: 'AG 中转 · ag/gemini-3.8-flash' });
    expect(index.agentProfile('writer')).toMatchObject({ purpose: 'agent', model: 'ag/claude-x', profileLabel: '写手' });
    const unlabeled = createProviderDisplayIndex({ ...(graph as object), services: { [SVC]: { ...(graph as any).services[SVC], label: undefined } } } as never);
    expect(unlabeled.resolveProvider(ACC)).toEqual({ key: SVC, label: 'openai-compatible' });
  });
});

describe('Agent workbench projections (#1250)', () => {
  it('replaces "- · -" with the purpose binding while keeping legacy config values separate', () => {
    const rows = projectAgentBindings([
      { name: 'zhin', provider: '-', model: '-', mcpServers: ['fs'] },
      { name: 'legacy', provider: 'openai', model: 'gpt-x' },
    ], createProviderDisplayIndex(graph));
    expect(rows[0]).toMatchObject({ name: 'zhin', provider: 'AG 中转', model: 'ag/gemini-3.8-flash', displayName: 'AG 中转 · ag/gemini-3.8-flash', bindingSource: 'purpose', purpose: 'chat', mcpServers: ['fs'] });
    expect(rows[0]).not.toHaveProperty('configuredProvider');
    expect(rows[1]).toMatchObject({ provider: 'AG 中转', configuredProvider: 'openai', configuredModel: 'gpt-x' });
    expect(projectAgentBindings([{ name: 'x', provider: '-', model: '-' }], undefined)[0]).toMatchObject({ provider: '-', model: '-', bindingSource: 'none' });
    expect(projectAgentBindings([{ name: 'x', provider: 'openai', model: 'gpt' }], undefined)[0]).toMatchObject({ provider: 'openai', bindingSource: 'config' });
  });

  it('lists recent turns newest first with names, status and models but no text', () => {
    const traces = [
      { turn_id: 't1', session_key: 'personal-session:v1:' + 'a'.repeat(64), started_at: 1, duration_ms: 5, termination: { status: 'completed' },
        usage: { total_tokens: 30 }, model_calls: [{ provider: ACC, model: 'ag/gemini-3.8-flash' }, { provider: SVC, model: 'ag/gemini-3.8-flash' }],
        origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' }, principal: { subject_id: 'u1', display_name: 'Alice', roles: [] },
        requests: [{ body: 'secret prompt' }] },
      { turn_id: 't2', session_key: 's2', started_at: 2, model_calls: [], termination: { status: 'failed' } },
      { bogus: true },
    ];
    const rows = projectRecentTurns(traces, createProviderDisplayIndex(graph), 10);
    expect(rows.map(row => row.turnId)).toEqual(['t2', 't1']);
    expect(rows[1]).toEqual({
      turnId: 't1', sessionKey: traces[0]!.session_key, sessionDisplayName: 'qq · 私聊 Alice', principal: 'Alice', startedAt: 1, durationMs: 5,
      status: 'completed', modelCalls: 2, totalTokens: 30, models: ['AG 中转 · ag/gemini-3.8-flash'],
    });
    expect(JSON.stringify(rows)).not.toContain('secret prompt');
    expect(projectRecentTurns(traces, undefined, 1)).toHaveLength(1);
  });

  it('serves effective bindings and recent turns through the Console introspection runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-insights-'));
    try {
      writeFileSync(join(root, 'zhin.config.yml'), 'ai:\n  agents:\n    zhin: {}\n');
      expect(new AgentConfigProjection(root).listBindings()).toMatchObject([{ name: 'zhin', provider: '-', model: '-' }]);
      const snapshot = { root: 'root', resources: new Map() } as never;
      const resolver = createAgentRuntimeLeaseResolver(root, { acquire: () => ({ value: snapshot, release() {} }) } as never, {
        providerDisplay: async () => createProviderDisplayIndex(graph),
        recentTraces: async () => [
          { turn_id: 't8', session_key: 'webhook:access_token=abc123secret', started_at: 8, model_calls: [], termination: { status: 'failed' },
            principal: { subject_id: 'u', display_name: 'Bearer abcdefghijklmnop', roles: [] } },
          { turn_id: 't9', session_key: 's', started_at: 9, model_calls: [], termination: { status: 'completed' } },
        ],
      })!;
      const lease = resolver()!;
      const bindings = await lease.value.introspection!.bindings!();
      expect(bindings[0]).toMatchObject({ name: 'zhin', provider: 'AG 中转', model: 'ag/gemini-3.8-flash' });
      const turns = await lease.value.introspection!.recentTurns!();
      expect(turns).toMatchObject([{ turnId: 't9', status: 'completed' }, { turnId: 't8' }]);
      // #1250: the same redaction pass as the trace archive routes.
      expect(JSON.stringify(turns)).not.toContain('abc123secret');
      expect(JSON.stringify(turns)).not.toContain('abcdefghijklmnop');
      expect(turns[1]).toMatchObject({ principal: 'Bearer [redacted]' });
      lease.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
