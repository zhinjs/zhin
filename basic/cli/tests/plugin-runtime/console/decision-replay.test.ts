import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { DecisionEventLog } from '@zhin.js/agent';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
import {
  cutPage,
  DECISION_EXPORT_PAGE_ROWS,
  DECISIONS_READ_PERMISSION,
  exportDecisionEvents,
  listDecisionEvents,
  type DecisionEventExportRow,
} from '../../../src/plugin-runtime/console/decision-replay.js';

const base = { instanceId: '10000', platform: 'icqq', sceneId: 'group:g1', actor: 'policy' as const };

async function seeded() {
  let now = 1_000;
  const log = new DecisionEventLog(() => now);
  const at = async (ts: number, input: Partial<Parameters<DecisionEventLog['record']>[0]>) => {
    now = ts;
    await log.record({ ...base, turnId: 't1', kind: 'inbound_wake', outcome: 'allow', reasonCode: 'inbound_addressed', ...input } as never);
  };
  await at(1_000, { turnId: 't1', kind: 'inbound_wake', payload: { token: 'sk-abcdefghijklmnop', events: 1 } });
  await at(1_100, { turnId: 't1', kind: 'speak_gate', outcome: 'deny', reasonCode: 'cannot_speak_muted' });
  await at(1_200, { turnId: 't1', kind: 'model_skip', outcome: 'skip', reasonCode: 'cannot_speak_muted' });
  await at(2_000, { turnId: 't2', platform: 'qq', kind: 'outbound', reasonCode: 'outbound_sent', actor: 'model' });
  return log;
}

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
  return (type: string, access: ConsoleAccess, data: Record<string, unknown> = {}) => dispatchPluginConsoleRpcRequest({ type, requestId: 1, data } as never,
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc: status.consoleRpc });
}

describe('Console decision replay (ADR 0036 slice C)', () => {
  it('lists newest-first with filters, drills a turn oldest-first, and needs decisions:read', async () => {
    const log = await seeded();
    const status = new AssistantStatus({ now: () => 9_999 });
    const call = host(status);
    expect(await call('plugin.root.decisions', unrestrictedConsoleAccess)).toMatchObject({ status: 503, body: { code: 'unavailable' } });
    status.bindDecisionEvents(() => log);

    const reader: ConsoleAccess = { unrestricted: false, permissions: [DECISIONS_READ_PERMISSION], roles: [] };
    const listed = await call('plugin.root.decisions', reader);
    expect(listed.status).toBe(200);
    const items = (listed.body as any).data.items as DecisionEventExportRow[];
    expect(items.map((row) => row.ts)).toEqual([2_000, 1_200, 1_100, 1_000]);
    expect(items[3]).toMatchObject({ turn_id: 't1', scene_id: 'group:g1', kind: 'inbound_wake', payload: { token: '[redacted]', events: 1 } });
    expect(JSON.stringify(listed)).not.toContain('sk-abcdefghijklmnop');
    expect((listed.body as any).data).toMatchObject({ persistent: false, nextBefore: null });

    const filtered = await call('plugin.root.decisions', reader, { platform: 'icqq', kind: 'speak_gate' });
    expect((filtered.body as any).data.items.map((row: DecisionEventExportRow) => row.kind)).toEqual(['speak_gate']);
    const byReason = await call('plugin.root.decisions', reader, { reasonCode: 'cannot_speak_muted' });
    expect((byReason.body as any).data.items.map((row: DecisionEventExportRow) => row.kind)).toEqual(['model_skip', 'speak_gate']);
    const paged = await call('plugin.root.decisions', reader, { limit: 2 });
    expect((paged.body as any).data).toMatchObject({ nextBefore: 1_200 });
    const next = await call('plugin.root.decisions', reader, { limit: 2, before: 1_200 });
    expect((next.body as any).data.items.map((row: DecisionEventExportRow) => row.ts)).toEqual([1_100, 1_000]);

    const turn = await call('plugin.root.decision-turn', reader, { turnId: 't1' });
    expect((turn.body as any).data).toMatchObject({ turnId: 't1', startedAt: 1_000, endedAt: 1_200, truncated: false });
    expect((turn.body as any).data.events.map((row: DecisionEventExportRow) => row.kind)).toEqual(['inbound_wake', 'speak_gate', 'model_skip']);
    expect(await call('plugin.root.decision-turn', reader, { turnId: 'nope' })).toMatchObject({ status: 404 });
    expect(await call('plugin.root.decision-turn', reader, {})).toMatchObject({ status: 400 });

    const stranger: ConsoleAccess = { unrestricted: false, permissions: ['ambient:read'], roles: [] };
    for (const method of ['plugin.root.decisions', 'plugin.root.decision-turn', 'plugin.root.decisions-export']) {
      expect(await call(method, stranger, { turnId: 't1', since: 0, until: 1 })).toMatchObject({ status: 403 });
    }
  });

  it('rejects bad filters instead of returning an empty page', async () => {
    const log = await seeded();
    const source = () => log;
    await expect(listDecisionEvents(source, { kind: 'speak' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(listDecisionEvents(source, { outcome: 'maybe' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(listDecisionEvents(source, { reasonCode: 'Cold Field' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(listDecisionEvents(source, { since: 5, before: 5 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(listDecisionEvents(source, { limit: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(exportDecisionEvents(source, { since: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(exportDecisionEvents(source, { since: 0, until: 32 * 86_400_000 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('exports a window oldest-first with table-shaped rows; inclusive bounds', async () => {
    const log = await seeded();
    const out = await exportDecisionEvents(() => log, { since: 1_100, until: 2_000, platform: 'icqq' }, () => 42) as any;
    expect(out).toMatchObject({ table: 'ai_decision_events', exportedAt: 42, window: { since: 1_100, until: 2_000 }, filters: { platform: 'icqq' }, count: 2, nextSince: null });
    expect(out.events.map((row: DecisionEventExportRow) => row.kind)).toEqual(['speak_gate', 'model_skip']);
    expect(Object.keys(out.events[0]).sort()).toEqual([
      'actor', 'actor_id', 'id', 'instance_id', 'kind', 'outcome', 'payload', 'platform', 'reason_code', 'reason_detail', 'scene_id', 'ts', 'turn_id', 'user_id',
    ]);
  });

  it('pages exports by size without splitting rows that share a millisecond', async () => {
    const big = 'x'.repeat(450);
    const rows = Array.from({ length: 1_200 }, (_, i) => ({
      id: `id${String(i).padStart(4, '0')}`, ts: 10_000 + Math.floor(i / 3), // three rows per millisecond
      turnId: `t${i}`, instanceId: '10000', platform: 'icqq', sceneId: 'group:g1', userId: null,
      kind: 'model_run', outcome: 'allow', reasonCode: 'model_completed', reasonDetail: null,
      payload: { note: big }, actor: 'model', actorId: null,
    })) as never as Awaited<ReturnType<DecisionEventLog['query']>>;
    const reader = { persistent: true, query: async (filter: any) => rows.filter((r) => r.ts >= filter.since && r.ts < filter.before).slice(0, filter.limit), turn: async () => [] };
    const seen: string[] = [];
    let since: number | null = 0;
    let pages = 0;
    while (since !== null) {
      const page = await exportDecisionEvents(() => reader, { since, until: 1_000_000 }) as any;
      expect(JSON.stringify(page).length).toBeLessThan(256 * 1024);
      seen.push(...page.events.map((row: DecisionEventExportRow) => row.id));
      since = page.nextSince;
      pages += 1;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('cutPage keeps equal-ts groups whole', () => {
    const row = (ts: number) => ({ ts, id: String(ts) } as unknown as DecisionEventExportRow);
    expect(cutPage([row(1), row(2), row(2), row(3)], 2).rows.map((r) => r.ts)).toEqual([1]);
    expect(cutPage([row(2), row(2), row(2)], 1)).toMatchObject({ more: false });
    expect(cutPage([row(1), row(2)], DECISION_EXPORT_PAGE_ROWS)).toMatchObject({ more: false });
  });
});
