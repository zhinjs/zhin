import { afterEach, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { publicConsoleAccess, unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { AssistantStatus } from '../../../src/instance/console/assistant-status.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/instance/console/plugin-console-rpc.js';

const HOUR = 60 * 60 * 1000;
const SECRET = 'user said: my password is hunter2';

function clock(start = 1_000_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

it('summarizes ambient decisions without chat text or judge reasons', () => {
  const time = clock();
  const status = new AssistantStatus({ now: time.now });
  status.bindAmbientConfig(() => ({ conversations: ['qq:1', 'qq:2'], mode: 'shadow' }));
  status.recordAmbient('qq:1', { kind: 'engage', judgment: { engage: true, confidence: 0.876, reason: SECRET } });
  time.advance(1);
  status.recordAmbient('qq:1', { kind: 'declined', judgment: { engage: false, confidence: 0.2, reason: SECRET, source: { kind: 'decision', model: 'small' }, sourceLabel: 'decision:small' } });
  time.advance(1);
  status.recordAmbient('qq:2', { kind: 'shadow', judgment: { engage: true, confidence: 0.9, reason: SECRET } });
  status.recordAmbient('qq:2', { kind: 'skipped', reason: 'superseded' });
  time.advance(1);
  status.recordAmbient('qq:2', { kind: 'skipped', reason: 'cooldown' });
  status.recordAmbientShadow(true, true);
  status.recordAmbientShadow(true, false);
  status.recordAmbientShadow(undefined, false);

  const snapshot = status.ambient(['groq/llama', ' ']);
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
  status.bindAmbientConfig(() => ({ conversations: ['*'] }));
  expect(status.ambient(['a/b'])).toMatchObject({ enabled: true, mode: 'active', groups: 'all', judges: ['a/b'] });
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

it('sums ambient judge calls and tokens per day in the instance time zone, keeping 7 days (#1250)', () => {
  // 2026-11-17 15:30 UTC = 23:30 in Asia/Shanghai.
  const time = clock(Date.UTC(2026, 10, 17, 15, 30));
  const status = new AssistantStatus({ now: time.now, timeZone: 'Asia/Shanghai' });
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 300,
    usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 100, totalTokens: 128 } });
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:备用站/chat-b', fallbackFrom: 'language:主站/chat-a', status: 'failed',
    errorCategory: 'auth', durationMs: 100 });
  status.recordAmbientJudgeCall({ kind: 'decision', source: 'decision:jev', status: 'completed', durationMs: 50, usage: { inputTokens: 40, outputTokens: 2, totalTokens: 42 } });
  time.advance(HOUR); // next local day
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 200, usage: { inputTokens: 10, outputTokens: 1 } });

  const snapshot = status.ambient();
  expect(snapshot.judgeTimeZone).toBe('Asia/Shanghai');
  expect(snapshot.judgeDaily).toEqual([
    { day: '2026-11-17', calls: 3, failed: 1, fallbacks: 1, byKind: { language: 2, decision: 1 }, averageMs: 150,
      inputTokens: 160, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 0, unreportedCalls: 1 },
    { day: '2026-11-18', calls: 1, failed: 0, fallbacks: 0, byKind: { language: 1, decision: 0 }, averageMs: 200,
      inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, unreportedCalls: 0 },
  ]);
  for (let day = 0; day < 8; day += 1) {
    time.advance(24 * HOUR);
    status.recordAmbientJudgeCall({ kind: 'decision', source: 'decision:jev', status: 'completed', durationMs: 10 });
  }
  const kept = status.ambient().judgeDaily;
  expect(kept).toHaveLength(7);
  expect(kept[0]!.day).toBe('2026-11-20');
  expect(kept.at(-1)).toMatchObject({ day: '2026-11-26', calls: 1, unreportedCalls: 1, inputTokens: 0 });
});

it('drops ambient judge days older than 7 days, on write and on read, after a long quiet spell (#1250)', () => {
  const time = clock(Date.UTC(2026, 10, 17, 4, 0)); // 12:00 in Asia/Shanghai
  const status = new AssistantStatus({ now: time.now, timeZone: 'Asia/Shanghai' });
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 100 });
  time.advance(24 * HOUR);
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 100 });
  expect(status.ambient().judgeDaily.map(day => day.day)).toEqual(['2026-11-17', '2026-11-18']);

  // Read only: six days later the first day is still inside the window, seven days later it is not.
  time.advance(5 * 24 * HOUR);
  expect(status.ambient().judgeDaily.map(day => day.day)).toEqual(['2026-11-17', '2026-11-18']);
  time.advance(24 * HOUR);
  expect(status.ambient().judgeDaily.map(day => day.day)).toEqual(['2026-11-18']);

  // Thirty-plus days of silence: no stale day is shown, and the next write keeps only today.
  time.advance(31 * 24 * HOUR);
  expect(status.ambient().judgeDaily).toEqual([]);
  status.recordAmbientJudgeCall({ kind: 'decision', source: 'decision:jev', status: 'completed', durationMs: 20 });
  expect(status.ambient().judgeDaily).toEqual([expect.objectContaining({ day: '2026-12-25', calls: 1, byKind: { language: 0, decision: 1 } })]);
});

it('reports judgeToday by the instance clock in the judge time zone, with or without calls (#1250)', () => {
  // 2026-11-17 23:30 UTC = 2026-11-18 07:30 in Asia/Shanghai: the instance's today is already the next day.
  const time = clock(Date.UTC(2026, 10, 17, 23, 30));
  const status = new AssistantStatus({ now: time.now, timeZone: 'Asia/Shanghai' });
  // No calls at all: judgeToday is still reported, and judgeDaily is empty.
  expect(status.ambient()).toMatchObject({ judgeTimeZone: 'Asia/Shanghai', judgeToday: '2026-11-18', judgeDaily: [] });
  expect(new AssistantStatus({ now: time.now, timeZone: 'UTC' }).ambient().judgeToday).toBe('2026-11-17');

  // Across local midnight (23:59:59.999 → 00:00 Asia/Shanghai), judgeToday follows the same cut as judgeDaily.
  time.advance(16 * HOUR + 30 * 60 * 1000 - 1); // 2026-11-18 23:59:59.999 Asia/Shanghai
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 10 });
  expect(status.ambient().judgeToday).toBe('2026-11-18');
  expect(status.ambient().judgeDaily.map(day => day.day)).toEqual(['2026-11-18']);
  time.advance(1);
  status.recordAmbientJudgeCall({ kind: 'language', source: 'language:主站/chat-a', status: 'completed', durationMs: 10 });
  const snapshot = status.ambient();
  expect(snapshot.judgeToday).toBe('2026-11-19');
  expect(snapshot.judgeDaily.map(day => day.day)).toEqual(['2026-11-18', '2026-11-19']);
  expect(snapshot.judgeDaily.at(-1)!.day).toBe(snapshot.judgeToday);
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
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc: () => status.consoleRpc });
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

it('counts agreement with the compared model over 24 hours, by deciding member, and keeps decisionShadow (ADR 0066 D3)', () => {
  const time = clock();
  const status = new AssistantStatus({ now: time.now });
  const chat = { kind: 'language' as const, profile: 'chat', model: 'chat' };
  const spare = { kind: 'language' as const, profile: 'spare', model: 'spare' };
  const jev = { kind: 'decision' as const, profile: 'jev', model: 'jev' };
  // Older than the window: dropped.
  status.recordAmbientCompare({ primarySpeaks: true, comparedSpeaks: true, primary: chat, compared: jev, member: 0 });
  time.advance(25 * HOUR);
  status.recordAmbientCompare({ primarySpeaks: true, comparedSpeaks: true, primary: chat, compared: jev, member: 0 });
  status.recordAmbientCompare({ primarySpeaks: false, comparedSpeaks: false, primary: chat, compared: jev, member: 0 });
  status.recordAmbientCompare({ primarySpeaks: true, comparedSpeaks: false, primary: chat, compared: jev, member: 0 });
  status.recordAmbientCompare({ primarySpeaks: false, comparedSpeaks: true, primary: spare, compared: jev, member: 1 });
  status.recordAmbientCompare({ primarySpeaks: true, primary: spare, member: 1, comparedFailure: 'timeout' });
  // The deciding side failed: nothing to compare.
  status.recordAmbientCompare({ comparedSpeaks: true, compared: jev });
  const ambient = status.ambient();
  expect(ambient.compare).toEqual({
    windowMs: 24 * HOUR, agreed: 2, primaryOnly: 1, comparedOnly: 1, failed: 1,
    byMember: [
      { member: 0, profile: 'chat', agreed: 2, primaryOnly: 1, comparedOnly: 0, failed: 0 },
      { member: 1, profile: 'spare', agreed: 0, primaryOnly: 0, comparedOnly: 1, failed: 1 },
    ],
    comparedProfiles: ['jev'],
  });
  expect(ambient.decisionShadow).toEqual({ agreed: 2, disagreed: 2 });
  time.advance(24 * HOUR + 1);
  expect(status.ambient().compare).toMatchObject({ agreed: 0, primaryOnly: 0, comparedOnly: 0, failed: 0, byMember: [] });
});

it('shows the judge chain actually used and reads the mode from purposes.ambient (ADR 0066 D7)', () => {
  const status = new AssistantStatus({ now: clock().now });
  // The retired yml mode no longer decides; the Agent host's view does.
  status.bindAmbientConfig(() => ({ conversations: ['*'], mode: 'active' }));
  const view = { mode: 'shadow' as const, minConfidence: 0.8,
    chain: [{ profile: 'jev', label: 'TypeSafe/jev', kind: 'decision' as const, role: 'primary' as const, skippedUntil: 5, skipReason: 'billing' },
      { profile: 'small', label: '主站/small', kind: 'language' as const, role: 'fallback' as const }],
    compare: { profile: 'chat', label: '主站/chat', kind: 'language' as const, role: 'compare' as const } };
  const ambient = status.ambient(view);
  expect(ambient).toMatchObject({ mode: 'shadow', minConfidence: 0.8, judges: ['TypeSafe/jev', '主站/small'] });
  expect(ambient.judgeChain.map(member => [member.profile, member.role])).toEqual([['jev', 'primary'], ['small', 'fallback'], ['chat', 'compare']]);
  // Older callers passing labels keep working.
  expect(status.ambient(['a/b'])).toMatchObject({ judges: ['a/b'], judgeChain: [], mode: 'active' });
});
