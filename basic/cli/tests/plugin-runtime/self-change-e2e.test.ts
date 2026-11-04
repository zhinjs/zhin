/**
 * #1051 F5 — controlled self-change end to end across process restarts (ADR 0040 §5 / §6).
 *
 * A fake supervisor stands in for `zhin start`: it records each exit code, decides with the real `planRespawn`
 * whether to start the runtime again, and every "process" is rebuilt from disk the way `startCommand` wires it
 * (fresh `SelfChangeStore` + `HostSelfChangeApply` + `SelfChangeApplier` bound to the generation's report ports,
 * then `started()` → `recover()`). Health is the host's own check: a process that reported a runtime error
 * after it started is unhealthy.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiControlPlane,
  SelfChangeApplier,
  SelfChangeApprovals,
  SelfChangeStore,
  createHostProtectedPaths,
  type SelfChangeOrigin,
  type SelfChangeRecord,
} from '@zhin.js/agent';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { HostSelfChangeApply } from '../../src/plugin-runtime/self-change-apply.js';
import { createSelfChangeGenerationPorts } from '../../src/plugin-runtime/agent/self-change-report.js';
import { planRespawn, processRestartExitCode, processRestartSupported } from '../../src/plugin-runtime/start/process-supervisor.js';

/** The change was asked for in a group; the owner (42) settles it in a private chat. */
const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'group:1001', userId: '42', endpoint: 'bot-1' };
const OWNER_DM = 'private:42';
const GROUP = 'group:1001';
const SUPERVISOR_PID = 4242;
const NEW_PING = 'export default "pong v2";\n';
const OLD_PING = 'export default "pong v1";\n';

let project: string;
const disposers: (() => void)[] = [];

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-e2e-'));
  mkdirSync(join(project, 'commands'), { recursive: true });
  writeFileSync(join(project, 'commands', 'ping.ts'), OLD_PING);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  rmSync(project, { recursive: true, force: true });
});

interface ProcessOptions {
  /** false: the process reports a runtime error right after it starts (the change broke it). */
  readonly healthy?: boolean;
  /** `RootHost.reloadSources`; default reloads fine. */
  readonly reload?: () => Promise<'reloaded' | 'restart'>;
  /** Process clock (leftover-approval window, Q2=B). */
  readonly now?: () => number;
}

interface RuntimeProcess {
  readonly store: SelfChangeStore;
  readonly host: HostSelfChangeApply;
  readonly approvals: SelfChangeApprovals;
  readonly queue: ToolApprovalQueue;
}

/** `zhin start` stand-in: exit codes in, respawn decisions out (real {@link planRespawn}). */
class FakeSupervisor {
  readonly exits: number[] = [];
  readonly sent: { to: string; text: string }[] = [];
  /** The control plane outlives a restart (it is persisted host state). */
  readonly control = new AiControlPlane();
  readonly processes: RuntimeProcess[] = [];
  #attempts: readonly number[] = [];
  #respawn = true;
  readonly #daemon: boolean;

  constructor(options: { daemon?: boolean } = {}) {
    this.#daemon = options.daemon ?? false;
  }

  /** The runtime process ended with `code` (75 = controlled restart, 137 = killed). */
  exit(code: number): void {
    this.exits.push(code);
    const plan = planRespawn(code, false, this.#daemon, this.#attempts);
    this.#attempts = plan.attempts;
    this.#respawn = plan.respawn;
  }

  /** Start a runtime process the way `startCommand` wires self-change (first start, or after a respawn). */
  async start(options: ProcessOptions = {}): Promise<RuntimeProcess> {
    if (!this.#respawn) throw new Error(`supervisor would not respawn after exit ${this.exits.at(-1)}`);
    this.#respawn = false;
    const store = new SelfChangeStore({
      root: join(project, '.zhin', 'changes'),
      projectRoot: project,
      protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    });
    const host = new HostSelfChangeApply({
      projectRoot: project,
      reload: options.reload ?? (async () => 'reloaded'),
      restart: () => this.exit(processRestartExitCode),
      snapshot: () => ({ generation: 1, tree: new Map<string, unknown>([['app', {}]]) }),
      // Started by the supervisor: ZHIN_SUPERVISOR_PID is our parent pid and not --once.
      restartSupported: processRestartSupported(false, { ZHIN_SUPERVISOR_PID: String(SUPERVISOR_PID) }, SUPERVISOR_PID),
    });
    const generation = createSelfChangeGenerationPorts({
      send: async (target, text) => { this.sent.push({ to: `${target.conversation.kind}:${target.conversation.id}`, text }); },
      resolveOwner: () => '42',
      control: () => this.control,
    });
    const applier = new SelfChangeApplier({
      store,
      projectRoot: project,
      ports: host.ports(generation),
      ...(options.now ? { now: options.now } : {}),
    });
    host.bind(applier, async () => (await store.list()).filter(record => record.status === 'approved').map(record => record.id));
    const queue = new ToolApprovalQueue();
    const approvals = new SelfChangeApprovals({ store, queue, onApproved: record => host.apply(record.id) });
    disposers.push(() => approvals.dispose());
    if (options.healthy === false) host.noteError();
    const runtime = { store, host, approvals, queue };
    this.processes.push(runtime);
    await host.started();
    return runtime;
  }
}

/** A trial-passed change from the group, submitted to the owner's `self` card. */
async function submittedChange(runtime: RuntimeProcess, impact: 'generation' | 'process'): Promise<SelfChangeRecord> {
  const { store, approvals } = runtime;
  const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: NEW_PING }] });
  await store.attachPlan(draft.id, draft.contentHash, {
    version: 1, contentHash: draft.contentHash, summary: '把 /ping 改成 v2', files: [],
    impact: { kind: impact, subtrees: ['app'], slots: [], reasons: [], estimated: false, config: null },
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
  return (await approvals.submit(draft.id)).record;
}

/** The owner approves in a private chat; resolves once the apply flow settled (or asked for a restart). */
async function approve(runtime: RuntimeProcess, id: string): Promise<void> {
  await runtime.approvals.decide(id, true, '42', 'im_dm');
  await runtime.approvals.drain();
  await waitFor(() => !runtime.host.active);
}

async function waitFor(condition: () => boolean | Promise<boolean>, label = 'condition'): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Read the record as the next process would: a fresh store over the same directory. */
async function onDisk(id: string): Promise<SelfChangeRecord | null> {
  return new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project }).get(id);
}

const ping = () => readFileSync(join(project, 'commands', 'ping.ts'), 'utf8');

describe('self-change e2e: restart path with a supervisor (exit 75)', () => {
  it('process change → verifying on disk → exit 75 → respawn → recover → applied, reported to the group', async () => {
    const supervisor = new FakeSupervisor();
    const first = await supervisor.start();
    const change = await submittedChange(first, 'process');
    await approve(first, change.id);

    expect(supervisor.exits).toEqual([75]);
    expect(ping()).toBe(NEW_PING);
    expect(await onDisk(change.id)).toMatchObject({ status: 'verifying', apply: { phase: 'forward', mode: 'process', restarts: 1 } });
    expect(supervisor.sent).toEqual([]); // the verdict belongs to the next process

    await supervisor.start();
    expect((await onDisk(change.id))?.status).toBe('applied');
    expect(supervisor.sent).toEqual([{ to: GROUP, text: expect.stringMatching(/^已生效：把 \/ping 改成 v2（已重启）/u) }]);
    expect(supervisor.exits).toEqual([75]);
  });

  it('unhealthy after the restart → snapshot rollback + one more restart → rolled_back reported to the group', async () => {
    const supervisor = new FakeSupervisor();
    const first = await supervisor.start();
    const change = await submittedChange(first, 'process');
    await approve(first, change.id);
    expect(supervisor.exits).toEqual([75]);

    await supervisor.start({ healthy: false });
    expect(ping()).toBe(OLD_PING);
    expect(supervisor.exits).toEqual([75, 75]);
    expect(await onDisk(change.id)).toMatchObject({ status: 'verifying', apply: { phase: 'rollback', restarts: 2 } });

    await supervisor.start();
    expect(await onDisk(change.id)).toMatchObject({ status: 'rolled_back', error: expect.stringContaining('health check failed') });
    expect(supervisor.sent).toEqual([{ to: GROUP, text: expect.stringMatching(/^失败，已回滚：把 \/ping 改成 v2/u) }]);
    expect(supervisor.exits).toEqual([75, 75]);
  });

  it('still unhealthy after the rollback restart → failed + emergency_stop, reported to the owner DM only, no more restarts', async () => {
    const supervisor = new FakeSupervisor();
    const first = await supervisor.start();
    const change = await submittedChange(first, 'process');
    await approve(first, change.id);
    await supervisor.start({ healthy: false });
    expect(supervisor.exits).toEqual([75, 75]);

    await supervisor.start({ healthy: false });
    expect(await onDisk(change.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('still unhealthy after rollback') });
    expect(supervisor.control.snapshot().instance.emergency_stop).toBe(true);
    expect(supervisor.control.snapshot().updatedBy).toBe(`self_change:${change.id}`);
    expect(supervisor.sent).toEqual([{ to: OWNER_DM, text: expect.stringContaining('已急停') }]);
    expect(supervisor.sent.some(message => message.to === GROUP)).toBe(false);
    expect(supervisor.exits).toEqual([75, 75]);
    await expect(supervisor.start()).rejects.toThrow('would not respawn');
  });
});

describe('self-change e2e: interrupted apply', () => {
  it('a process killed mid-applying is rolled back on the next start', async () => {
    const supervisor = new FakeSupervisor({ daemon: true });
    // The reload never returns: the process is killed while the change is `applying` with files written.
    const first = await supervisor.start({ reload: () => new Promise<never>(() => undefined) });
    const change = await submittedChange(first, 'generation');
    await first.approvals.decide(change.id, true, '42', 'im_dm');
    await waitFor(async () => (await onDisk(change.id))?.status === 'applying' && ping() === NEW_PING, 'applying with files written');
    supervisor.exit(137);

    await supervisor.start();
    expect(ping()).toBe(OLD_PING);
    expect(await onDisk(change.id)).toMatchObject({ status: 'rolled_back', error: 'interrupted while applying' });
    expect(supervisor.sent).toEqual([{ to: GROUP, text: expect.stringContaining('失败，已回滚') }]);
  });
});

describe('self-change e2e: leftover approved at start (Q2=B)', () => {
  async function leftoverApproved(): Promise<SelfChangeRecord> {
    // Approved, then the process ended before onApproved ran (no applier bound in this process).
    const store = new SelfChangeStore({
      root: join(project, '.zhin', 'changes'),
      projectRoot: project,
      protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    });
    const queue = new ToolApprovalQueue();
    const approvals = new SelfChangeApprovals({ store, queue });
    const change = await submittedChange({ store, approvals, queue, host: undefined as never }, 'generation');
    await approvals.decide(change.id, true, '42', 'im_dm');
    await approvals.drain();
    const approved = await onDisk(change.id);
    expect(approved?.status).toBe('approved');
    approvals.dispose();
    return approved!;
  }

  it('applies a change approved within the last hour once the next process starts', async () => {
    const change = await leftoverApproved();
    const supervisor = new FakeSupervisor();
    await supervisor.start({ now: () => change.updatedAt + 30 * 60_000 });
    expect(ping()).toBe(NEW_PING);
    expect((await onDisk(change.id))?.status).toBe('applied');
    expect(supervisor.sent).toEqual([{ to: GROUP, text: expect.stringMatching(/^已生效/u) }]);
  });

  it('expires an approval older than an hour without touching files and asks the owner to draft again', async () => {
    const change = await leftoverApproved();
    const supervisor = new FakeSupervisor();
    await supervisor.start({ now: () => change.updatedAt + 2 * 60 * 60_000 });
    expect(ping()).toBe(OLD_PING);
    expect(existsSync(join(project, '.zhin', 'changes', change.id, 'snapshot'))).toBe(false);
    expect(await onDisk(change.id)).toMatchObject({ status: 'expired' });
    expect(supervisor.sent).toEqual([{ to: OWNER_DM, text: expect.stringContaining('批准已过期') }]);
    expect(supervisor.sent[0]!.text).toContain('请重新起草');
    expect(supervisor.exits).toEqual([]);
  });
});
