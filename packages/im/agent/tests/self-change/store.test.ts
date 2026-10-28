import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { SelfChangePathError, SelfChangeConfigKeyError } from '../../src/self-change/policy.js';
import {
  SelfChangeQuotaError,
  SelfChangeStateError,
  SelfChangeStore,
  type SelfChangeOrigin,
  type SelfChangeStoreOptions,
} from '../../src/self-change/store.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'private:42', userId: '42', endpoint: 'bot-1' };

let project: string;
let changesRoot: string;
let clock: number;
let audit: DecisionEventInput[];

async function makeStore(options: Partial<SelfChangeStoreOptions> = {}): Promise<SelfChangeStore> {
  return new SelfChangeStore({
    root: changesRoot,
    projectRoot: project,
    protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    audit: () => ({ record: (input) => { audit.push(input); } }),
    now: () => clock,
    ...options,
  });
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-store-'));
  changesRoot = join(project, '.zhin', 'changes');
  clock = 1_700_000_000_000;
  audit = [];
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe('SelfChangeStore drafts', () => {
  it('stages files outside production and records only path + digest', async () => {
    const store = await makeStore();
    const record = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'export default 1;\n' }] });
    expect(record).toMatchObject({ status: 'draft', revision: 0, slimmed: false });
    expect(record.files).toEqual([expect.objectContaining({ path: 'commands/ping.ts', op: 'write', bytes: 18 })]);
    expect(existsSync(join(project, 'commands', 'ping.ts'))).toBe(false);
    expect(existsSync(join(changesRoot, record.id, 'files', 'commands', 'ping.ts'))).toBe(true);
    expect(await store.readStagedFile(record.id, 'commands/ping.ts')).toBe('export default 1;\n');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'self_change', reasonCode: 'change_drafted', outcome: 'allow', platform: 'icqq', sceneId: 'private:42', instanceId: 'bot-1' });
    expect(JSON.stringify(audit[0]!.payload)).not.toContain('export default');
  });

  it('replaces the draft content on update and re-hashes', async () => {
    const store = await makeStore();
    const first = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }, { path: 'tools/x.ts', content: 'x' }] });
    const second = await store.draft({ id: first.id, origin, files: [{ path: 'commands/ping.ts', content: 'b' }] });
    expect(second.revision).toBe(1);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(existsSync(join(changesRoot, first.id, 'files', 'tools', 'x.ts'))).toBe(false);
    expect(readdirSync(join(changesRoot, first.id)).sort()).toEqual(['change.json', 'files']);
  });

  it('only lets the originator edit, and only while in draft', async () => {
    const store = await makeStore();
    const record = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }] });
    await expect(store.draft({ id: record.id, origin: { ...origin, userId: '99' }, files: [{ path: 'commands/ping.ts', content: 'b' }] }))
      .rejects.toThrow(SelfChangeStateError);
    await store.transition(record.id, 'trialing', { actor: 'system', reasonCode: 'change_drafted' });
    await expect(store.draft({ id: record.id, origin, files: [{ path: 'commands/ping.ts', content: 'b' }] }))
      .rejects.toThrow(SelfChangeStateError);
  });

  it('rejects forbidden paths and config keys before writing anything', async () => {
    const store = await makeStore();
    await expect(store.draft({ origin, files: [{ path: 'commands/ok.ts', content: 'a' }, { path: 'pnpm-lock.yaml', content: 'x' }] }))
      .rejects.toThrow(SelfChangePathError);
    await expect(store.draft({ origin, configPatch: { expectedRevision: 'r', patches: [{ op: 'set', path: ['ai', 'agent', 'toolHardGate', 'enabled'], value: false }] } }))
      .rejects.toThrow(SelfChangeConfigKeyError);
    expect(existsSync(changesRoot)).toBe(false);
    expect(audit.map(event => [event.reasonCode, event.outcome])).toEqual([
      ['change_path_forbidden', 'deny'],
      ['change_config_key_forbidden', 'deny'],
    ]);
  });

  it('enforces the per-change file and byte quotas up front', async () => {
    const store = await makeStore({ maxChangeFiles: 2, maxChangeBytes: 10 });
    const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `commands/c${i}.ts`, content: 'a' }));
    await expect(store.draft({ origin, files: files(3) })).rejects.toThrow(SelfChangeQuotaError);
    await expect(store.draft({ origin, files: [{ path: 'commands/big.ts', content: 'x'.repeat(11) }] })).rejects.toThrow(SelfChangeQuotaError);
    expect(existsSync(changesRoot)).toBe(false);
    expect(audit.every(event => event.reasonCode === 'change_quota_exceeded')).toBe(true);
  });

  it('enforces the staging-area total, after pruning stale changes first', async () => {
    const store = await makeStore({ maxTotalBytes: 4_000 });
    const stale = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'a'.repeat(1_500) }] });
    // Within the cap the store does not prune.
    const fresh = await store.draft({ origin, files: [{ path: 'commands/b.ts', content: 'b'.repeat(1_000) }] });
    await expect(store.draft({ origin, files: [{ path: 'commands/c.ts', content: 'c'.repeat(1_500) }] }))
      .rejects.toThrow(SelfChangeQuotaError);
    // Once the stale draft passes its idle TTL, it is expired + slimmed to make room.
    clock += DAY + 1;
    await store.draft({ id: fresh.id, origin, files: [{ path: 'commands/b.ts', content: 'b' }] });
    const third = await store.draft({ origin, files: [{ path: 'commands/c.ts', content: 'c'.repeat(1_500) }] });
    expect(third.status).toBe('draft');
    expect((await store.get(stale.id))).toMatchObject({ status: 'expired', slimmed: true });
    expect(await store.usage()).toBeLessThanOrEqual(4_000);
  });
});

describe('SelfChangeStore transitions', () => {
  it('walks the happy path, binds the approval to content_hash and slims on applied', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }] });
    await store.transition(draft.id, 'trialing', { actor: 'system', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'ready', { actor: 'system', trial: { ok: true } });
    await store.transition(draft.id, 'pending', { actor: 'model' });
    const approved = await store.transition(draft.id, 'approved', { actor: 'operator', actorId: 'master' });
    expect(approved).toMatchObject({ approvedBy: 'master', approvedHash: draft.contentHash });
    mkdirSync(join(changesRoot, draft.id, 'snapshot', 'commands'), { recursive: true });
    writeFileSync(join(changesRoot, draft.id, 'snapshot', 'commands', 'ping.ts'), 'old');
    await store.transition(draft.id, 'applying', { actor: 'system', reasonCode: 'change_applied_reload', reportTarget: { kind: 'private', id: '42' } });
    const applied = await store.transition(draft.id, 'applied', { actor: 'system' });
    expect(applied).toMatchObject({ status: 'applied', slimmed: true, terminalAt: clock });
    expect(readdirSync(join(changesRoot, draft.id))).toEqual(['change.json']);
    expect(audit.map(event => event.reasonCode)).toEqual([
      'change_drafted', 'change_drafted', 'change_trial_passed', 'change_submitted', 'change_approved',
      'change_applied_reload', 'change_verified',
    ]);
  });

  it('refuses backwards moves and intermediate steps without a reason code', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }] });
    await expect(store.transition(draft.id, 'pending', { actor: 'model' })).rejects.toThrow(SelfChangeStateError);
    await expect(store.transition(draft.id, 'trialing', { actor: 'system' })).rejects.toThrow(/reasonCode/u);
  });

  it.each(['trial_failed', 'rejected', 'expired', 'rolled_back'] as const)('slims immediately on %s', async (terminal) => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }] });
    const path: Record<typeof terminal, readonly [string, ...string[]]> = {
      trial_failed: ['trialing'],
      rejected: ['trialing', 'ready', 'pending'],
      expired: ['trialing', 'ready'],
      rolled_back: ['trialing', 'ready', 'pending', 'approved', 'applying'],
    };
    for (const step of path[terminal]) await store.transition(draft.id, step as never, { actor: 'system', reasonCode: 'change_drafted' });
    const done = await store.transition(draft.id, terminal, { actor: 'policy', error: 'boom' });
    expect(done.slimmed).toBe(true);
    expect(readdirSync(join(changesRoot, draft.id))).toEqual(['change.json']);
    expect(await store.readStagedFile(draft.id, 'commands/ping.ts')).toBeNull();
  });

  it('keeps the failed scene until a person marks it handled', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'a' }] });
    for (const step of ['trialing', 'ready', 'pending', 'approved', 'applying'] as const) {
      await store.transition(draft.id, step, { actor: 'system', reasonCode: 'change_drafted' });
    }
    const failed = await store.transition(draft.id, 'failed', { actor: 'system', error: 'still unhealthy' });
    expect(failed).toMatchObject({ slimmed: false, terminalAt: null });
    clock += 30 * DAY;
    await store.prune();
    expect(existsSync(join(changesRoot, draft.id, 'files', 'commands', 'ping.ts'))).toBe(true);
    const handled = await store.markFailedHandled(draft.id, 'master');
    expect(handled).toMatchObject({ slimmed: true, terminalAt: clock });
    clock += 14 * DAY + 1;
    expect((await store.prune()).removed).toEqual([draft.id]);
  });
});

describe('SelfChangeStore pruning', () => {
  it('expires idle draft / ready / pending changes after 24 hours', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'a' }] });
    const pending = await store.draft({ origin, files: [{ path: 'commands/b.ts', content: 'b' }] });
    for (const step of ['trialing', 'ready', 'pending'] as const) await store.transition(pending.id, step, { actor: 'system', reasonCode: 'change_drafted' });
    clock += DAY - 1;
    expect((await store.prune()).expired).toEqual([]);
    clock += 2;
    const result = await store.prune();
    expect([...result.expired].sort()).toEqual([draft.id, pending.id].sort());
    expect(await store.get(draft.id)).toMatchObject({ status: 'expired', slimmed: true });
    expect(audit.filter(event => event.reasonCode === 'change_expired').every(event => event.actor === 'policy' && event.outcome === 'skip')).toBe(true);
  });

  it('removes terminal changes after the 14-day retention', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'a' }] });
    await store.transition(draft.id, 'trialing', { actor: 'system', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'trial_failed', { actor: 'system', error: 'syntax error' });
    clock += 14 * DAY;
    expect((await store.prune()).removed).toEqual([]);
    clock += 1;
    expect((await store.prune()).removed).toEqual([draft.id]);
    expect(existsSync(join(changesRoot, draft.id))).toBe(false);
    expect(audit.at(-1)).toMatchObject({ reasonCode: 'change_pruned', outcome: 'skip' });
  });

  it('leaves in-flight apply states to recover()', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'a' }] });
    for (const step of ['trialing', 'ready', 'pending', 'approved', 'applying'] as const) {
      await store.transition(draft.id, step, { actor: 'system', reasonCode: 'change_drafted' });
    }
    clock += 30 * DAY;
    await store.prune();
    expect(await store.get(draft.id)).toMatchObject({ status: 'applying', slimmed: false });
  });

  it('closes a trial that was interrupted by a crash', async () => {
    const store = await makeStore();
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'a' }] });
    await store.transition(draft.id, 'trialing', { actor: 'system', reasonCode: 'change_drafted' });
    clock += DAY + 1;
    await store.prune();
    expect(await store.get(draft.id)).toMatchObject({ status: 'trial_failed', error: 'trial interrupted', slimmed: true });
  });

  it('removes stray entries without following symlinks', async () => {
    const outside = join(project, 'precious');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    mkdirSync(join(changesRoot, 'broken-change'), { recursive: true });
    writeFileSync(join(changesRoot, 'broken-change', 'change.json'), '{not json');
    symlinkSync(outside, join(changesRoot, 'escape'));
    writeFileSync(join(changesRoot, 'stray.tmp'), 'x');
    const old = (clock - 2 * DAY) / 1000;
    utimesSync(join(changesRoot, 'broken-change'), old, old);
    utimesSync(join(changesRoot, 'stray.tmp'), old, old);
    const store = await makeStore();
    // A symlink's own mtime cannot be set portably: the store treats it as fresh until the idle TTL.
    clock = Date.now() + 2 * DAY;
    const result = await store.prune();
    expect([...result.removed].sort()).toEqual(['broken-change', 'escape', 'stray.tmp']);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(readdirSync(changesRoot)).toEqual([]);
  });

  it('prunes on start and on the interval, and stops on dispose', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const store = await makeStore();
      const spy = vi.spyOn(store, 'prune');
      const stop = store.startPruning(1_000);
      expect(spy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      expect(spy).toHaveBeenCalledTimes(3);
      stop();
      vi.advanceTimersByTime(5_000);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op when the staging area does not exist', async () => {
    const store = await makeStore();
    expect(await store.prune()).toEqual({ expired: [], slimmed: [], removed: [], totalBytes: 0 });
  });
});
