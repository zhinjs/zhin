import { afterEach, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { publicConsoleAccess, unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';

const HOUR = 60 * 60 * 1000;
const SECRET = 'user said: my password is hunter2';

function clock(start = 1_000_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

it('summarizes ambient decisions without chat text or judge reasons', () => {
  const time = clock();
  const status = new AssistantStatus({ now: time.now });
  status.bindAmbientConfig(() => ({ conversations: ['qq:1', 'qq:2'], judge: ['groq/llama', ' '], mode: 'shadow' }));
  status.recordAmbient('qq:1', { kind: 'engage', judgment: { engage: true, confidence: 0.876, reason: SECRET } });
  time.advance(1);
  status.recordAmbient('qq:1', { kind: 'declined', judgment: { engage: false, confidence: 0.2, reason: SECRET, source: 'decision:small' } });
  time.advance(1);
  status.recordAmbient('qq:2', { kind: 'shadow', judgment: { engage: true, confidence: 0.9, reason: SECRET } });
  status.recordAmbient('qq:2', { kind: 'skipped', reason: 'superseded' });
  time.advance(1);
  status.recordAmbient('qq:2', { kind: 'skipped', reason: 'cooldown' });
  status.recordAmbientShadow(true, true);
  status.recordAmbientShadow(true, false);
  status.recordAmbientShadow(undefined, false);

  const snapshot = status.ambient();
  expect(snapshot).toMatchObject({
    enabled: true, mode: 'shadow', groups: 2, judges: ['groq/llama'],
    last24h: { spoke: 1, watched: 1, stayed_quiet: 1, skipped: 1 },
    decisionShadow: { agreed: 1, disagreed: 1 },
    updatedAt: time.now(),
  });
  expect(snapshot.recent.map((item) => item.outcome)).toEqual(['skipped', 'watched', 'stayed_quiet', 'spoke']);
  expect(snapshot.recent[0]).toEqual({ at: time.now(), group: 'qq:2', outcome: 'skipped', skipReason: 'cooldown' });
  expect(snapshot.recent[2]).toMatchObject({ confidence: 0.2, judge: 'decision' });
  expect(snapshot.recent[3]).toMatchObject({ confidence: 0.88, judge: 'chat-model' });
  expect(JSON.stringify(snapshot)).not.toContain('hunter2');
});

it('reports off without configured groups and all for the wildcard', () => {
  const status = new AssistantStatus();
  expect(status.ambient()).toMatchObject({ enabled: false, mode: 'off', groups: 0, judges: [], recent: [], updatedAt: null });
  status.bindAmbientConfig(() => ({ conversations: ['*'], judge: 'a/b' }));
  expect(status.ambient()).toMatchObject({ enabled: true, mode: 'active', groups: 'all', judges: ['a/b'] });
});

it('keeps a rolling 24h window and at most 20 recent items', () => {
  const time = clock();
  const status = new AssistantStatus({ now: time.now });
  status.recordAmbient('qq:old', { kind: 'skipped', reason: 'no_context' });
  time.advance(25 * HOUR);
  for (let index = 0; index < 30; index += 1) status.recordAmbient(`qq:${index}`, { kind: 'skipped', reason: 'hourly_cap' });
  const snapshot = status.ambient();
  expect(snapshot.last24h.skipped).toBe(30);
  expect(snapshot.recent).toHaveLength(20);
  expect(snapshot.recent[0]!.group).toBe('qq:29');
});

it('aggregates structured decision calls per task for 技能助手', () => {
  const time = clock();
  const status = new AssistantStatus({ now: time.now });
  status.recordDecision({ task: 'skills', mode: 'active', outcome: 'selected', candidates: 3, durationMs: 100, model: 'm1', usage: { inputTokens: 50, outputTokens: 5 } } as never);
  time.advance(1);
  status.recordDecision({ task: 'skills', mode: 'active', outcome: 'failed', candidates: 3, durationMs: 300.4, reason: 'timeout' } as never);
  time.advance(1);
  status.recordDecision({ task: 'ambient', mode: 'shadow', outcome: 'shadow', durationMs: 20, model: 'm2', usage: { inputTokens: 10, outputTokens: -1 } } as never);
  const snapshot = status.skills();
  expect(snapshot.tasks).toEqual([
    { task: 'ambient', mode: 'shadow', calls: 1, selected: 0, abstained: 0, shadow: 1, failed: 0, averageMs: 20, inputTokens: 10, outputTokens: 0, lastModel: 'm2', lastAt: time.now() },
    { task: 'skills', mode: 'active', calls: 2, selected: 1, abstained: 0, shadow: 0, failed: 1, averageMs: 200, inputTokens: 50, outputTokens: 5, lastModel: 'm1', lastAt: time.now() - 1 },
  ]);
  expect(snapshot.totals).toEqual({ calls: 3, inputTokens: 60, outputTokens: 5 });
  expect(snapshot.recent[1]).toEqual({ at: time.now() - 1, task: 'skills', mode: 'active', outcome: 'failed', durationMs: 300, reason: 'timeout' });
  expect(snapshot.updatedAt).toBe(time.now());
});

const stores: SnapshotStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });

function host(status: AssistantStatus) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  return (type: string, access: ConsoleAccess) => dispatchPluginConsoleRpcRequest({ type, requestId: 1 },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc: status.consoleRpc });
}

it('serves plugin.root.ambient / plugin.root.skills to tokens holding the matching permission', async () => {
  const status = new AssistantStatus();
  status.recordAmbient('qq:1', { kind: 'declined', judgment: { engage: false, confidence: 0.1, reason: SECRET } });
  const call = host(status);
  const alice: ConsoleAccess = { unrestricted: false, permissions: ['ambient:read'], roles: ['member'] };
  const ambient = await call('plugin.root.ambient', alice);
  expect(ambient).toMatchObject({ status: 200, body: { success: true, data: { last24h: { stayed_quiet: 1 } } } });
  expect(JSON.stringify(ambient)).not.toContain('hunter2');
  expect(await call('plugin.root.skills', alice)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
  expect(await call('plugin.root.ambient', publicConsoleAccess)).toMatchObject({ status: 403 });
  expect(await call('plugin.root.skills', unrestrictedConsoleAccess)).toMatchObject({ status: 200, body: { data: { tasks: [] } } });
  expect(await call('plugin.root.status', unrestrictedConsoleAccess)).toMatchObject({ status: 404 });
});
