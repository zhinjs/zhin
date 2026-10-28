import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiControlPlane,
  SelfChangeApplier,
  SelfChangeStore,
  createHostProtectedPaths,
  type SelfChangeOrigin,
  type SelfChangeRecord,
} from '@zhin.js/agent';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import {
  HostSelfChangeApply,
  createSelfChangeConfigPort,
  type SelfChangeApplyHostOptions,
} from '../../../src/plugin-runtime/self-change-apply.js';
import { createSelfChangeGenerationPorts, type SelfChangeReportTarget } from '../../../src/plugin-runtime/agent/self-change-report.js';

const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'group:1001', userId: '42', endpoint: 'bot-1' };

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-host-'));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function record(overrides: Partial<SelfChangeRecord> = {}): SelfChangeRecord {
  return {
    id: 'chg_1',
    files: [{ path: 'commands/ping.ts', op: 'write', sha256: 'x', bytes: 1 }],
    configPatch: null,
    ...overrides,
  } as unknown as SelfChangeRecord;
}

function hostOptions(overrides: Partial<SelfChangeApplyHostOptions> = {}): SelfChangeApplyHostOptions & { reloaded: string[][]; restarts: number } {
  const options = {
    reloaded: [] as string[][],
    restarts: 0,
    projectRoot: project,
    reload: async (sources: readonly string[]) => {
      options.reloaded.push([...sources]);
      return 'reloaded' as const;
    },
    restart: () => { options.restarts += 1; },
    snapshot: () => ({ generation: 2, tree: new Map<string, unknown>([['app', {}]]) }),
    ...overrides,
  };
  return options;
}

const noGeneration = {
  emergencyStop: async () => undefined,
  report: async () => 'sent' as const,
};

describe('HostSelfChangeApply ports', () => {
  it('reloads the written files as absolute sources, plus the root config file for a config patch', async () => {
    const options = hostOptions({ configFile: join(project, 'zhin.config.yml') });
    const ports = new HostSelfChangeApply(options).ports(noGeneration);
    expect(await ports.reload({ record: record(), changed: ['commands/ping.ts'] })).toBe('reloaded');
    expect(options.reloaded[0]).toEqual([join(project, 'commands', 'ping.ts')]);
    await ports.reload({ record: record({ configPatch: { expectedRevision: 'r1', patches: [] } }), changed: [] });
    expect(options.reloaded[1]).toEqual([join(project, 'zhin.config.yml')]);
    await ports.requestRestart(record());
    expect(options.restarts).toBe(1);
  });

  it('is unhealthy when a runtime error was reported after the change started applying', async () => {
    const host = new HostSelfChangeApply(hostOptions());
    host.noteError(); // before the change: does not count
    const health = host.ports(noGeneration).health;
    let during: unknown;
    host.bind({
      apply: async () => {
        expect(await health({ record: record(), restarted: false, signal: new AbortController().signal })).toEqual({ ok: true });
        host.noteError();
        during = await health({ record: record(), restarted: false, signal: new AbortController().signal });
      },
      recover: async () => 0,
    });
    await host.apply('chg_1');
    expect(during).toMatchObject({ ok: false, error: expect.stringContaining('1 runtime error') });
  });

  it('after a restart counts every error of this process', async () => {
    const host = new HostSelfChangeApply(hostOptions());
    const health = host.ports(noGeneration).health;
    expect(await health({ record: record(), restarted: true, signal: new AbortController().signal })).toEqual({ ok: true });
    host.noteError();
    expect(await health({ record: record(), restarted: true, signal: new AbortController().signal })).toMatchObject({ ok: false });
  });

  it('is unhealthy when the plugin owning a changed file is not assembled, or no generation is committed', async () => {
    const ownership = { ownersForPath: (source: string) => (source.endsWith('ping.ts') ? ['missing-plugin'] : []) };
    const health = new HostSelfChangeApply(hostOptions({ ownership: () => ownership })).ports(noGeneration).health;
    expect(await health({ record: record(), restarted: true, signal: new AbortController().signal }))
      .toMatchObject({ ok: false, error: expect.stringContaining('missing-plugin') });
    const none = new HostSelfChangeApply(hostOptions({ snapshot: () => { throw new Error('not started'); } })).ports(noGeneration).health;
    expect(await none({ record: record(), restarted: true, signal: new AbortController().signal }))
      .toMatchObject({ ok: false, error: expect.stringContaining('no committed generation') });
  });
});

describe('HostSelfChangeApply lifecycle', () => {
  it('serializes applies across generations and reports activity', async () => {
    const host = new HostSelfChangeApply(hostOptions());
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    host.bind({
      apply: async (id) => {
        order.push(`start ${id}`);
        if (id === 'a') await gate;
        order.push(`end ${id}`);
      },
      recover: async () => 0,
    });
    const first = host.apply('a');
    const second = host.apply('b');
    await Promise.resolve();
    expect(host.active).toBe(true);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(host.active).toBe(false);
  });

  it('reports instead of throwing when no generation is bound', async () => {
    const errors: unknown[] = [];
    await new HostSelfChangeApply(hostOptions()).apply('chg_1', error => errors.push(error));
    expect(String(errors[0])).toContain('no Agent generation');
  });

  it('recovers once per process after start, then applies changes approved but never applied', async () => {
    const host = new HostSelfChangeApply(hostOptions());
    const calls: string[] = [];
    const applier = {
      apply: async (id: string) => { calls.push(`apply ${id}`); },
      recover: async () => { calls.push('recover'); return 1; },
    };
    const unbind = host.bind(applier, async () => ['chg_left']);
    expect(calls).toEqual([]); // not before the first generation has started
    await host.started();
    expect(calls).toEqual(['recover', 'apply chg_left']);
    unbind();
    // A later generation (reload) does not recover again.
    host.bind(applier, async () => ['chg_left']);
    await host.apply('chg_2');
    expect(calls).toEqual(['recover', 'apply chg_left', 'apply chg_2']);
  });
});

describe('createSelfChangeConfigPort', () => {
  it('patches one section per request, Host sections without instanceKey, chaining revisions', async () => {
    const requests: ConsoleConfigPatchRequest[] = [];
    const port = createSelfChangeConfigPort({
      readSource: async () => ({ source: 'a: 1\n', revision: 'r1' }),
      patch: async (request) => {
        requests.push(request);
        return { status: 'saved', revision: `${request.expectedRevision}+`, restartRequired: request.instanceKey === undefined, paths: [], missingEnv: [], message: 'ok' } as ConsoleConfigPatchResult;
      },
      replaceSource: async (_source, expectedRevision) => ({ revision: `${expectedRevision}!`, restartRequired: false }),
    });
    expect(await port.read()).toEqual({ source: 'a: 1\n', revision: 'r1' });
    const result = await port.patch('r1', [
      { op: 'set', path: ['weather', 'unit'], value: 'C' },
      { op: 'set', path: ['http', 'port'], value: 8087 },
      { op: 'remove', path: ['weather', 'city'] },
    ]);
    expect(requests.map(request => [request.instanceKey, request.expectedRevision, request.patches.length]))
      .toEqual([['weather', 'r1', 2], [undefined, 'r1+', 1]]);
    expect(result).toEqual({ status: 'saved', revision: 'r1++', restartRequired: true });
    expect(await port.restore('a: 1\n', 'r9')).toEqual({ revision: 'r9!', restartRequired: false });
  });

  it('stops at the first section that is not saved', async () => {
    let calls = 0;
    const port = createSelfChangeConfigPort({
      readSource: async () => ({ source: '', revision: 'r1' }),
      patch: async () => {
        calls += 1;
        return { status: 'conflict', revision: 'r2', current: [], message: 'changed elsewhere' } as ConsoleConfigPatchResult;
      },
      replaceSource: async () => ({ revision: 'r', restartRequired: false }),
    });
    expect(await port.patch('r1', [
      { op: 'set', path: ['a', 'x'], value: 1 },
      { op: 'set', path: ['b', 'y'], value: 2 },
    ])).toEqual({ status: 'conflict', message: 'changed elsewhere' });
    expect(calls).toBe(1);
  });
});

describe('createSelfChangeGenerationPorts', () => {
  function setup(options: { failOrigin?: boolean; owner?: string } = {}) {
    const sent: { target: SelfChangeReportTarget; text: string }[] = [];
    const control = new AiControlPlane();
    const ports = createSelfChangeGenerationPorts({
      send: async (target, text) => {
        if (options.failOrigin && target.conversation.kind !== 'private') throw new Error('bot left the group');
        sent.push({ target, text });
      },
      resolveOwner: () => options.owner,
      control: () => control,
    });
    return { sent, control, ports };
  }
  const input = (overrides: { ownerOnly?: boolean; target?: SelfChangeOrigin } = {}) => ({
    record: record(), kind: 'applied' as const, text: '已生效', target: overrides.target ?? origin, ownerOnly: overrides.ownerOnly ?? false,
  });

  it('reports to the originating conversation', async () => {
    const { sent, ports } = setup({ owner: '42' });
    expect(await ports.report(input())).toBe('sent');
    expect(sent).toEqual([{ target: { adapter: 'icqq', endpointKey: 'bot-1', conversation: { kind: 'group', id: '1001' } }, text: '已生效' }]);
  });

  it('redirects to the owner private chat when the conversation is unreachable', async () => {
    const { sent, ports } = setup({ failOrigin: true, owner: '42' });
    expect(await ports.report(input())).toBe('redirected');
    expect(sent.map(entry => entry.target.conversation)).toEqual([{ kind: 'private', id: '42' }]);
    expect(await setup({ failOrigin: true }).ports.report(input())).toBe('failed');
  });

  it('is blocked by the control plane, except owner-only emergency reports', async () => {
    const { sent, control, ports } = setup({ owner: '42' });
    await ports.emergencyStop(record(), 'still unhealthy');
    expect(control.snapshot().instance.emergency_stop).toBe(true);
    expect(control.snapshot().updatedBy).toBe('self_change:chg_1');
    expect(await ports.report(input())).toBe('blocked');
    expect(await ports.report(input({ ownerOnly: true }))).toBe('sent');
    expect(sent.map(entry => entry.target.conversation)).toEqual([{ kind: 'private', id: '42' }]);
  });

  it('fails without an endpoint to send through', async () => {
    const { ports } = setup({ owner: '42' });
    expect(await ports.report(input({ target: { ...origin, endpoint: null } }))).toBe('failed');
  });
});

describe('approved change through the host ports', () => {
  it('writes, reloads through the host, verifies and reports to the group', async () => {
    const store = new SelfChangeStore({
      root: join(project, '.zhin', 'changes'),
      projectRoot: project,
      protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    });
    const draft = await store.draft({ origin, files: [{ path: 'commands/ping.ts', content: 'export default "pong";\n' }] });
    await store.attachPlan(draft.id, draft.contentHash, {
      version: 1, contentHash: draft.contentHash, summary: '加一个 /ping 指令', files: [],
      impact: { kind: 'generation', subtrees: ['app'], slots: [], reasons: [], estimated: false, config: null },
    });
    await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
    await store.transition(draft.id, 'pending', { actor: 'policy' });
    await store.transition(draft.id, 'approved', { actor: 'operator', actorId: '42', approvedBy: '42' });

    const options = hostOptions();
    const host = new HostSelfChangeApply(options);
    const sent: string[] = [];
    const generation = createSelfChangeGenerationPorts({
      send: async (target, text) => { sent.push(`${target.conversation.kind}:${target.conversation.id} ${text}`); },
      control: () => new AiControlPlane(),
    });
    host.bind(new SelfChangeApplier({ store, projectRoot: project, ports: host.ports(generation) }));
    await host.apply(draft.id);

    expect(readFileSync(join(project, 'commands', 'ping.ts'), 'utf8')).toBe('export default "pong";\n');
    expect(options.reloaded).toEqual([[join(project, 'commands', 'ping.ts')]]);
    expect((await store.get(draft.id))?.status).toBe('applied');
    expect(sent).toEqual([expect.stringMatching(/^group:1001 已生效/u)]);
  });
});

describe('HostSelfChangeApply deferred restart', () => {
  it('holds a watcher restart until the apply flow is done, and runs it at once when idle', async () => {
    const host = new HostSelfChangeApply(hostOptions());
    let restarts = 0;
    host.deferRestart(() => { restarts += 1; });
    expect(restarts).toBe(1);
    host.bind({
      apply: async () => {
        host.deferRestart(() => { restarts += 1; });
        expect(restarts).toBe(1);
      },
      recover: async () => 0,
    });
    await host.apply('chg_1');
    expect(restarts).toBe(2);
  });
});
