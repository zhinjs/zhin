import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import { SelfChangeApprovals } from '../../src/self-change/approval.js';
import {
  SelfChangeApplier,
  type SelfChangeApplyPorts,
  type SelfChangeConfigPort,
  type SelfChangeHealth,
  type SelfChangeReportInput,
} from '../../src/self-change/apply.js';
import type { SelfChangeImpactKind } from '../../src/self-change/preview.js';
import { SelfChangeStore, type SelfChangeOrigin } from '../../src/self-change/store.js';

const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'private:42', userId: '42', endpoint: 'bot-1' };

let project: string;
let audit: DecisionEventInput[];

async function makeStore(): Promise<SelfChangeStore> {
  return new SelfChangeStore({
    root: join(project, '.zhin', 'changes'),
    projectRoot: project,
    protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    audit: () => ({ record: (input) => { audit.push(input); } }),
  });
}

interface FakeHost {
  ports: SelfChangeApplyPorts;
  reports: SelfChangeReportInput[];
  reloads: number;
  restarts: number;
  stops: string[];
  /** 依次返回的健康结论；用尽后为健康。 */
  health: SelfChangeHealth[];
  reloadResult: 'reloaded' | 'restart' | Error;
}

function fakeHost(config?: SelfChangeConfigPort): FakeHost {
  const host: FakeHost = {
    reports: [],
    reloads: 0,
    restarts: 0,
    stops: [],
    health: [],
    reloadResult: 'reloaded',
    ports: undefined as unknown as SelfChangeApplyPorts,
  };
  host.ports = {
    ...(config ? { config } : {}),
    async reload() {
      host.reloads += 1;
      if (host.reloadResult instanceof Error) throw host.reloadResult;
      return host.reloadResult;
    },
    requestRestart() { host.restarts += 1; },
    async health() { return host.health.shift() ?? { ok: true }; },
    async emergencyStop(_record, reason) { host.stops.push(reason); },
    async report(input) { host.reports.push(input); return 'sent'; },
  };
  return host;
}

async function approvedChange(
  store: SelfChangeStore,
  input: { files?: { path: string; content?: string; delete?: boolean }[]; configPatch?: unknown; impact?: SelfChangeImpactKind } = {},
) {
  const draft = await store.draft({
    origin,
    files: input.files ?? [{ path: 'commands/ping.ts', content: 'export default "pong";\n' }],
    ...(input.configPatch ? { configPatch: input.configPatch } : {}),
  });
  await store.attachPlan(draft.id, draft.contentHash, {
    version: 1,
    contentHash: draft.contentHash,
    summary: '加一个 /ping 指令',
    files: [],
    impact: { kind: input.impact ?? 'generation', subtrees: ['app'], slots: [], reasons: [], estimated: false, config: null },
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
  await store.transition(draft.id, 'pending', { actor: 'policy' });
  return store.transition(draft.id, 'approved', { actor: 'operator', actorId: '42', approvedBy: '42' });
}

function applier(store: SelfChangeStore, host: FakeHost, healthWindowMs?: number) {
  return new SelfChangeApplier({ store, projectRoot: project, ports: host.ports, ...(healthWindowMs ? { healthWindowMs } : {}) });
}

function changeDir(id: string): string {
  return join(project, '.zhin', 'changes', id);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-apply-'));
  audit = [];
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe('SelfChangeApplier — hot reload path', () => {
  it('writes the files, reloads, verifies and reports "已生效"; staging keeps only change.json', async () => {
    const store = await makeStore();
    const host = fakeHost();
    const change = await approvedChange(store);
    expect(await applier(store, host).apply(change.id)).toBe('applied');
    expect(readFileSync(join(project, 'commands', 'ping.ts'), 'utf8')).toBe('export default "pong";\n');
    expect(host.reloads).toBe(1);
    expect(host.restarts).toBe(0);
    const record = await store.get(change.id);
    expect(record?.status).toBe('applied');
    expect(record?.slimmed).toBe(true);
    expect(readdirSync(changeDir(change.id))).toEqual(['change.json']);
    expect(host.reports).toHaveLength(1);
    expect(host.reports[0]).toMatchObject({ kind: 'applied', ownerOnly: false, target: { platform: 'icqq', sceneId: 'private:42' } });
    expect(host.reports[0]!.text).toContain('已生效');
    const codes = audit.map(event => event.reasonCode);
    expect(codes).toEqual(expect.arrayContaining(['change_applied_reload', 'change_verified', 'change_report_sent']));
    // 审计不带文件正文。
    expect(JSON.stringify(audit)).not.toContain('pong');
  });

  it('applies a `none` change without reloading', async () => {
    const store = await makeStore();
    const host = fakeHost();
    const change = await approvedChange(store, { impact: 'none' });
    expect(await applier(store, host).apply(change.id)).toBe('applied');
    expect(host.reloads).toBe(0);
  });

  it('snapshots before writing and rolls back once when the health check fails', async () => {
    mkdirSync(join(project, 'commands'), { recursive: true });
    writeFileSync(join(project, 'commands', 'ping.ts'), 'export default "old";\n');
    const store = await makeStore();
    const host = fakeHost();
    host.health = [{ ok: false, error: 'plugin app did not assemble' }];
    const change = await approvedChange(store, {
      files: [
        { path: 'commands/ping.ts', content: 'export default "new";\n' },
        { path: 'commands/extra.ts', content: 'export default 1;\n' },
      ],
    });
    expect(await applier(store, host).apply(change.id)).toBe('rolled_back');
    expect(readFileSync(join(project, 'commands', 'ping.ts'), 'utf8')).toBe('export default "old";\n');
    expect(existsSync(join(project, 'commands', 'extra.ts'))).toBe(false);
    expect(host.reloads).toBe(2);
    const record = await store.get(change.id);
    expect(record?.status).toBe('rolled_back');
    expect(record?.error).toContain('plugin app did not assemble');
    expect(readdirSync(changeDir(change.id))).toEqual(['change.json']);
    expect(host.reports.map(report => report.kind)).toEqual(['rolled_back']);
    expect(host.reports[0]!.text).toContain('失败，已回滚');
    expect(host.stops).toEqual([]);
  });

  it('rolls back when the reload itself throws', async () => {
    const store = await makeStore();
    const host = fakeHost();
    host.reloadResult = new Error('assembler threw');
    const change = await approvedChange(store);
    // 回滚后的重载也抛 → 急停。
    expect(await applier(store, host).apply(change.id)).toBe('failed');
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
    expect(host.stops).toHaveLength(1);
  });

  it('enters emergency stop when still unhealthy after the rollback, keeps the evidence and reports to the owner only', async () => {
    const store = await makeStore();
    const host = fakeHost();
    host.health = [{ ok: false, error: 'boom' }, { ok: false, error: 'still boom' }];
    const change = await approvedChange(store);
    expect(await applier(store, host).apply(change.id)).toBe('failed');
    const record = await store.get(change.id);
    expect(record?.status).toBe('failed');
    expect(record?.slimmed).toBe(false);
    expect(readdirSync(changeDir(change.id)).sort()).toEqual(['change.json', 'files', 'snapshot']);
    expect(host.stops).toHaveLength(1);
    expect(host.restarts).toBe(0);
    expect(host.reports).toHaveLength(1);
    expect(host.reports[0]).toMatchObject({ kind: 'failed', ownerOnly: true });
    expect(audit.map(event => event.reasonCode)).toContain('change_failed_emergency_stop');
  });

  it('treats a health check that does not answer within the window as unhealthy', async () => {
    const store = await makeStore();
    const host = fakeHost();
    let calls = 0;
    host.ports = { ...host.ports, health: () => (calls++ === 0 ? new Promise<SelfChangeHealth>(() => undefined) : Promise.resolve({ ok: true })) };
    const change = await approvedChange(store);
    expect(await applier(store, host, 20).apply(change.id)).toBe('rolled_back');
    expect((await store.get(change.id))?.error).toContain('no healthy generation');
  });
});

describe('SelfChangeApplier — verification before touching anything', () => {
  it('fails without writing when a staged file changed after approval', async () => {
    const store = await makeStore();
    const host = fakeHost();
    const change = await approvedChange(store);
    writeFileSync(join(changeDir(change.id), 'files', 'commands', 'ping.ts'), 'export default "evil";\n');
    expect(await applier(store, host).apply(change.id)).toBe('failed');
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
    expect(host.reloads).toBe(0);
    expect(host.stops).toEqual([]);
    expect(audit.map(event => event.reasonCode)).toContain('change_hash_mismatch');
    expect(host.reports[0]!.text).toContain('未改动任何文件');
  });

  it('fails without writing when the config revision moved since drafting', async () => {
    const store = await makeStore();
    const config = fakeConfig('a: 1\n', 'r2');
    const host = fakeHost(config);
    const change = await approvedChange(store, { configPatch: { expectedRevision: 'r1', patches: [{ op: 'set', path: ['weather', 'unit'], value: 'c' }] } });
    expect(await applier(store, host).apply(change.id)).toBe('failed');
    expect(config.patched).toBe(0);
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
  });

  it('refuses to follow a symlinked target out of the project', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'zhin-change-outside-'));
    try {
      const store = await makeStore();
      const host = fakeHost();
      // 起草时 commands/ 还不存在；批准后被换成指向项目外的链接。
      const change = await approvedChange(store);
      symlinkSync(outside, join(project, 'commands'));
      expect(await applier(store, host).apply(change.id)).not.toBe('applied');
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('SelfChangeApplier — restart path and recover()', () => {
  it('persists verifying before requesting a restart, then recover() verifies and reports "已重启"', async () => {
    const store = await makeStore();
    const host = fakeHost();
    const change = await approvedChange(store, { impact: 'process' });
    expect(await applier(store, host).apply(change.id)).toBe('restarting');
    expect(host.restarts).toBe(1);
    const pending = await store.get(change.id);
    expect(pending?.status).toBe('verifying');
    expect(pending?.apply).toMatchObject({ phase: 'forward', mode: 'process', restarts: 1 });
    expect(pending?.reportTarget).toMatchObject({ platform: 'icqq', sceneId: 'private:42' });

    // 「重启」后的新进程：新的 store 与 applier。
    const nextHost = fakeHost();
    expect(await applier(await makeStore(), nextHost).recover()).toBe(1);
    expect((await store.get(change.id))?.status).toBe('applied');
    expect(nextHost.reports[0]!.text).toContain('已重启');
  });

  it('upgrades to a restart when the reload reports one, and when a config patch needs a restart', async () => {
    const store = await makeStore();
    const host = fakeHost();
    host.reloadResult = 'restart';
    const change = await approvedChange(store);
    expect(await applier(store, host).apply(change.id)).toBe('restarting');

    const config = fakeConfig('a: 1\n', 'r1', true);
    const configHost = fakeHost(config);
    const other = await approvedChange(store, { files: [{ path: 'commands/b.ts', content: 'x' }], configPatch: { expectedRevision: 'r1', patches: [{ op: 'set', path: ['http', 'port'], value: 1 }] } });
    expect(await applier(store, configHost).apply(other.id)).toBe('restarting');
    expect(config.patched).toBe(1);
  });

  it('after a restart that comes back unhealthy, rolls back with one more restart and then reports', async () => {
    const store = await makeStore();
    const change = await approvedChange(store, { impact: 'process' });
    await applier(store, fakeHost()).apply(change.id);

    const second = fakeHost();
    second.health = [{ ok: false, error: 'startup error' }];
    await applier(await makeStore(), second).recover();
    expect(second.restarts).toBe(1);
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
    expect((await store.get(change.id))?.apply).toMatchObject({ phase: 'rollback', restarts: 2 });

    const third = fakeHost();
    await applier(await makeStore(), third).recover();
    expect((await store.get(change.id))?.status).toBe('rolled_back');
    expect(third.reports[0]).toMatchObject({ kind: 'rolled_back' });
    expect(third.restarts).toBe(0);
  });

  it('does not restart in a loop: unhealthy after the rollback restart → emergency stop', async () => {
    const store = await makeStore();
    const change = await approvedChange(store, { impact: 'process' });
    await applier(store, fakeHost()).apply(change.id);
    const second = fakeHost();
    second.health = [{ ok: false, error: 'a' }];
    await applier(await makeStore(), second).recover();
    const third = fakeHost();
    third.health = [{ ok: false, error: 'b' }];
    await applier(await makeStore(), third).recover();
    expect((await store.get(change.id))?.status).toBe('failed');
    expect(third.restarts).toBe(0);
    expect(third.stops).toHaveLength(1);
    expect(third.reports[0]).toMatchObject({ kind: 'failed', ownerOnly: true });
  });

  it('a process killed mid-apply is rolled back by recover()', async () => {
    mkdirSync(join(project, 'commands'), { recursive: true });
    writeFileSync(join(project, 'commands', 'ping.ts'), 'old\n');
    const store = await makeStore();
    const change = await approvedChange(store, { impact: 'generation', files: [{ path: 'commands/ping.ts', content: 'new\n' }] });
    // 模拟：快照与 applying 已落盘、文件已写一半，进程被强杀。
    await store.writeSnapshot(change.id, { files: [{ path: 'commands/ping.ts', content: 'old\n' }], config: null });
    await store.transition(change.id, 'applying', {
      actor: 'policy', reasonCode: 'change_applied_reload',
      reportTarget: origin, apply: { phase: 'forward', mode: 'generation', restarts: 0, failure: null },
    });
    writeFileSync(join(project, 'commands', 'ping.ts'), 'ne');

    const host = fakeHost();
    expect(await applier(await makeStore(), host).recover()).toBe(1);
    expect(readFileSync(join(project, 'commands', 'ping.ts'), 'utf8')).toBe('old\n');
    expect(host.reloads).toBe(1);
    const record = await store.get(change.id);
    expect(record?.status).toBe('rolled_back');
    expect(record?.error).toContain('interrupted while applying');
    expect(host.reports[0]).toMatchObject({ kind: 'rolled_back' });
  });

  it('rolls the config back from the snapshot source', async () => {
    const store = await makeStore();
    const config = fakeConfig('weather:\n  unit: f\n', 'r1');
    const host = fakeHost(config);
    host.health = [{ ok: false, error: 'bad config' }];
    const change = await approvedChange(store, { configPatch: { expectedRevision: 'r1', patches: [{ op: 'set', path: ['weather', 'unit'], value: 'c' }] } });
    expect(await applier(store, host).apply(change.id)).toBe('rolled_back');
    expect(config.source).toBe('weather:\n  unit: f\n');
    expect(config.restored).toBe(1);
  });
});

describe('SelfChangeApprovals → applier', () => {
  it('hands an approved change to onApproved after a human approves it', async () => {
    const store = await makeStore();
    const queue = new ToolApprovalQueue();
    const approved: string[] = [];
    const approvals = new SelfChangeApprovals({ store, queue, onApproved: (record) => { approved.push(record.id); } });
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'x' }] });
    await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
    await approvals.submit(draft.id);
    await approvals.decide(draft.id, true, '42', 'im_dm');
    await approvals.drain();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(approved).toEqual([draft.id]);
  });
});

function fakeConfig(source: string, revision: string, restartRequired = false) {
  let counter = 0;
  const state = {
    source,
    revision,
    patched: 0,
    restored: 0,
    async read() { return { source: state.source, revision: state.revision }; },
    async patch(expectedRevision: string) {
      if (expectedRevision !== state.revision) return { status: 'conflict' as const, message: 'stale' };
      state.patched += 1;
      state.source = `${state.source}# patched\n`;
      state.revision = `${revision}-p${++counter}`;
      return { status: 'saved' as const, revision: state.revision, restartRequired };
    },
    async restore(next: string, expectedRevision: string) {
      if (expectedRevision !== state.revision) throw new Error('stale');
      state.restored += 1;
      state.source = next;
      state.revision = `${revision}-r${++counter}`;
      return { revision: state.revision, restartRequired };
    },
  };
  return state;
}
