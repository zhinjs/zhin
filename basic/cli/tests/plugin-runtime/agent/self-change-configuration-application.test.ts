import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelfChangeApplier, SelfChangeStore, createHostProtectedPaths, configPatchImpact, type DecisionEventInput } from '@zhin.js/agent';
import { createConfigDocument, ConfigurationSupersededError, ConfigValidationError, HOST_CONFIG_KEYS } from '@zhin.js/runtime';
import type { ConsoleConfigApplication } from '@zhin.js/console-protocol';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { HostSelfChangeApply } from '../../../src/plugin-runtime/self-change-apply.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function application(sourceRevision: string): ConsoleConfigApplication {
  return { operationId: 'self-change-config', sourceRevision, saved: true, generation: 2, applicationRevision: 1,
    groups: [{ id: 'ambient', paths: [['ai', 'trigger', 'ambient']], effect: 'in-place', status: 'applied', dependsOn: [] }] };
}
async function fixture(options: { outcome?: 'unconfirmed' | 'superseded' | 'invalid' | 'restore-unconfirmed' | 'restore-invalid'
  | 'partial-pending' | 'group-unknown' | 'write-unconfirmed' | 'group-failed' | 'group-blocked'
  | 'unsaved-receipt' | 'zero-generation-receipt'; files?: boolean; multipleSections?: boolean;
  processPlan?: boolean; legacyHost?: boolean; restartSupported?: boolean } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-self-change-config-')); roots.push(projectRoot);
  const configFile = join(projectRoot, 'zhin.config.json');
  const initial = JSON.stringify({ configVersion: 2, plugins: options.multipleSections ? { extra: './extra' } : {},
    ...(options.multipleSections ? { extra: { level: 1 } } : {}), ai: { trigger: { ambient: { mode: 'shadow', quietMs: 100 } } } });
  await writeFile(configFile, initial);
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 'self-change-config',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  if (options.multipleSections) {
    await mkdir(join(projectRoot, 'extra'));
    await writeFile(join(projectRoot, 'extra/package.json'), JSON.stringify({ name: 'extra',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(projectRoot, 'extra/schema.json'), JSON.stringify({ type: 'object', properties: { level: { type: 'integer' } } }));
  }
  let calls = 0;
  const document = createConfigDocument(configFile);
  if (options.outcome === 'write-unconfirmed') {
    const prepare = document.prepare.bind(document);
    vi.spyOn(document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => { await prepared.commit(); throw new Error('synthetic-private-error'); } };
    });
  }
  const configuration = new ConsoleConfigurationStore({ projectRoot, document,
    validateConfiguration: options.multipleSections ? async candidate => {
      if ((candidate.extra as { level?: number })?.level === 2) throw new ConfigValidationError(['synthetic second-section rejection']);
    } : undefined,
    applyConfiguration: options.legacyHost ? undefined : async revision => {
      calls++;
      if (options.outcome === 'unconfirmed' || options.outcome === 'restore-unconfirmed' && calls === 2) throw new Error('synthetic-private-error');
      if (options.outcome === 'superseded') {
        await writeFile(configFile, JSON.stringify({ configVersion: 2, plugins: {}, ai: { trigger: { ambient: { mode: 'shadow', quietMs: 200 } } } }));
        throw new ConfigurationSupersededError();
      }
      if (options.outcome === 'invalid' && calls === 1 || options.outcome === 'restore-invalid' && calls === 2) throw new ConfigValidationError(['synthetic-invalid']);
      if ((options.outcome === 'group-failed' || options.outcome === 'group-blocked') && calls === 1) return { ...application(revision!),
        groups: [{ ...application(revision!).groups[0]!, status: options.outcome === 'group-failed' ? 'failed' : 'blocked' }] };
      if (options.outcome === 'unsaved-receipt' || options.outcome === 'zero-generation-receipt') return { ...application(revision!), groups: [],
        saved: options.outcome !== 'unsaved-receipt', generation: options.outcome === 'zero-generation-receipt' ? 0 : 2 };
      if (options.outcome === 'partial-pending' || options.outcome === 'group-unknown') return { ...application(revision!), groups: [
        ...application(revision!).groups,
        { id: 'pending', paths: [['ai', 'trigger', 'ambient']], effect: 'restart-process' as const, status: 'restart-pending' as const, dependsOn: [] },
        ...(options.outcome === 'group-unknown' ? [{ id: 'uncertain', paths: [], effect: 'reload-plugin' as const, status: 'unknown' as const, dependsOn: [] }] : []),
      ] };
      return application(revision!);
    } });
  const revision = (await configuration.readSource()).revision;
  const events: DecisionEventInput[] = [];
  const store = new SelfChangeStore({ root: join(projectRoot, '.zhin/changes'), projectRoot,
    protectedPaths: await createHostProtectedPaths({ projectRoot }), audit: () => ({ record: event => events.push(event) }) });
  const draft = await store.draft({ origin: { platform: 'fixture', endpoint: 'bot', sceneId: 'private:owner', userId: 'owner' },
    files: options.files ? [{ path: 'commands/ping.ts', content: 'export default "new";\n' }] : [],
    configPatch: { expectedRevision: revision, patches: [{ op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'active' },
      ...(options.multipleSections ? [{ op: 'set', path: ['extra', 'level'], value: 2 }] : [])] } });
  const configImpact = options.processPlan ? configPatchImpact(draft.configPatch!, HOST_CONFIG_KEYS) : null;
  await store.attachPlan(draft.id, draft.contentHash, { version: 1, contentHash: draft.contentHash, summary: 'bounded config change', files: [],
    impact: { kind: configImpact?.kind ?? 'generation', subtrees: [], slots: [], reasons: configImpact?.reasons ?? [], estimated: false, config: configImpact } });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
  await store.transition(draft.id, 'pending', { actor: 'policy' });
  await store.transition(draft.id, 'approved', { actor: 'operator', actorId: 'owner', approvedBy: 'owner' });
  const reload = vi.fn(async () => 'reloaded' as const), restart = vi.fn(), emergencyStop = vi.fn(async () => undefined);
  const reports: string[] = [];
  const host = new HostSelfChangeApply({ projectRoot, configFile, configuration, reload, restart,
    restartSupported: options.restartSupported,
    snapshot: () => ({ generation: 2, tree: new Map() }) });
  const ports = host.ports({ emergencyStop, report: async input => { reports.push(input.text); return 'sent'; } });
  const applier = new SelfChangeApplier({ store, projectRoot, ports: { ...ports,
    ...(options.outcome?.startsWith('restore-') ? { health: async () => ({ ok: false as const, error: 'synthetic health failure' }) } : {}) } });
  return { projectRoot, configFile, initial, configuration, store, draft, applier, reload, restart, emergencyStop, reports, events, calls: () => calls };
}

it.each(['unconfirmed', 'superseded', 'group-unknown', 'write-unconfirmed', 'unsaved-receipt', 'zero-generation-receipt'] as const)('preserves a saved %s application without reload, rollback, restart or false success through the real Console/Host/applier path', async outcome => {
  const f = await fixture({ outcome });
  expect(await f.applier.apply(f.draft.id)).toBe('failed');
  expect(JSON.parse(await readFile(f.configFile, 'utf8')).ai.trigger.ambient.mode).toBe(outcome === 'superseded' ? 'shadow' : 'active');
  expect(f.calls()).toBe(outcome === 'write-unconfirmed' ? 0 : 1);
  expect(f.reload).not.toHaveBeenCalled(); expect(f.restart).not.toHaveBeenCalled(); expect(f.emergencyStop).not.toHaveBeenCalled();
  expect((await f.store.get(f.draft.id))?.slimmed).toBe(false);
  expect((await f.store.get(f.draft.id))?.error).toContain(outcome === 'superseded' ? 'superseded' : 'unconfirmed');
  if (outcome === 'superseded') expect(JSON.parse(await readFile(f.configFile, 'utf8')).ai.trigger.ambient.quietMs).toBe(200);
  expect(f.reports.join('\n')).not.toContain('已生效');
  expect(f.reports.join('\n')).not.toContain('已回滚');
  expect(f.reports.join('\n')).not.toContain('synthetic-private-error');
  expect(f.events.map(event => event.reasonCode)).toContain(outcome === 'superseded' ? 'change_config_superseded' : 'change_config_unconfirmed');
  expect(f.events.map(event => event.reasonCode)).not.toContain('change_failed_emergency_stop');
  expect(await f.applier.recover()).toBe(0);
});

it.each([false, true])('does not reapply confirmed configuration; mixed changes still reload just their source files (files=%s)', async files => {
  const f = await fixture({ files });
  expect(await f.applier.apply(f.draft.id)).toBe('applied');
  expect(f.calls()).toBe(1);
  expect(f.reload.mock.calls).toEqual(files ? [[[join(f.projectRoot, 'commands/ping.ts')]]] : []);
  expect(f.restart).not.toHaveBeenCalled();
});

it('lets a confirmed pure configuration receipt refine the actual conservative Host process preview', async () => {
  const f = await fixture({ processPlan: true });
  expect((await f.store.get(f.draft.id))?.plan).toMatchObject({ impact: { kind: 'process', config: { kind: 'process', hostSections: ['ai'] } } });
  expect(await f.applier.apply(f.draft.id)).toBe('applied');
  expect(f.calls()).toBe(1); expect(f.restart).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
});

it.each(['mixed', 'legacy', 'no-supervisor'] as const)('preserves the conservative process boundary for %s', async scenario => {
  const f = await fixture({ processPlan: true, files: scenario === 'mixed', legacyHost: scenario === 'legacy', restartSupported: scenario !== 'no-supervisor' });
  expect(await f.applier.apply(f.draft.id)).toBe(scenario === 'no-supervisor' ? 'failed' : 'restarting');
  expect(f.restart).toHaveBeenCalledTimes(scenario === 'no-supervisor' ? 0 : 1);
  if (scenario === 'no-supervisor') {
    expect(f.calls()).toBe(0);
    expect(await readFile(f.configFile, 'utf8')).toBe(f.initial);
  }
});

it.each(['invalid', 'group-failed', 'group-blocked'] as const)('rolls back a known %s saved configuration, and trusts the confirmed restore without another config reload', async outcome => {
  const f = await fixture({ outcome });
  expect(await f.applier.apply(f.draft.id)).toBe('rolled_back');
  expect(await readFile(f.configFile, 'utf8')).toBe(f.initial);
  expect(f.calls()).toBe(2); expect(f.reload).not.toHaveBeenCalled(); expect(f.emergencyStop).not.toHaveBeenCalled();
  expect((await f.store.get(f.draft.id))?.error).toContain(outcome === 'invalid' ? 'invalid' : outcome.slice(6));
});

it('retains the first saved section revision when validation throws before saving the second section', async () => {
  const f = await fixture({ multipleSections: true });
  expect(await f.applier.apply(f.draft.id)).toBe('rolled_back');
  expect(await readFile(f.configFile, 'utf8')).toBe(f.initial);
  expect(f.calls()).toBe(2);
  expect(f.reload).not.toHaveBeenCalled(); expect(f.restart).not.toHaveBeenCalled(); expect(f.emergencyStop).not.toHaveBeenCalled();
  expect(f.events.map(event => event.reasonCode)).not.toContain('change_config_superseded');
});

it.each(['restore-unconfirmed', 'restore-invalid'] as const)('does not report a rollback when its saved restore is %s', async outcome => {
  const f = await fixture({ outcome });
  expect(await f.applier.apply(f.draft.id)).toBe('failed');
  expect(await readFile(f.configFile, 'utf8')).toBe(f.initial);
  expect(f.calls()).toBe(2); expect(f.reload).not.toHaveBeenCalled(); expect(f.restart).not.toHaveBeenCalled();
  expect(f.reports.join('\n')).not.toMatch(/^(?:失败|未生效)，已回滚/mu);
  expect((await f.store.get(f.draft.id))?.slimmed).toBe(false);
  expect(f.emergencyStop).toHaveBeenCalledTimes(outcome === 'restore-invalid' ? 1 : 0);
});

it('keeps the approved restart flow for confirmed partial application and verifies without applying again after restart', async () => {
  const f = await fixture({ outcome: 'partial-pending' });
  expect(await f.applier.apply(f.draft.id)).toBe('restarting');
  expect(f.calls()).toBe(1); expect(f.restart).toHaveBeenCalledTimes(1); expect(f.reload).not.toHaveBeenCalled();
  expect((await f.store.get(f.draft.id))?.status).toBe('verifying');
  expect(await f.applier.recover()).toBe(1);
  expect((await f.store.get(f.draft.id))?.status).toBe('applied');
  expect(f.calls()).toBe(1);
});

it.each(['superseded', 'legacy', 'in-flight', 'owned'] as const)('a fresh recovery port restores only its durably acknowledged revision (%s)', async scenario => {
  const f = await fixture({ outcome: 'partial-pending', files: true });
  expect(await f.applier.apply(f.draft.id)).toBe('restarting');
  const record = (await f.store.get(f.draft.id))!;
  expect(record.apply?.configRevision).toBe((await f.configuration.readSource()).revision);
  if (scenario === 'superseded') await writeFile(f.configFile, JSON.stringify({ configVersion: 2, plugins: {},
    ai: { trigger: { ambient: { mode: 'shadow', quietMs: 999 } } } }));
  else if (scenario !== 'owned') await f.store.setApplyState(record.id, { ...record.apply!, configRevision: scenario === 'legacy' ? undefined : record.apply!.configRevision,
    configApplication: scenario === 'in-flight' ? 'unconfirmed' : record.apply!.configApplication });
  const source = await readFile(f.configFile, 'utf8');
  const applyConfiguration = vi.fn(async (revision?: string) => application(revision!));
  const configuration = new ConsoleConfigurationStore({ projectRoot: f.projectRoot, document: createConfigDocument(f.configFile), applyConfiguration });
  const restore = vi.spyOn(configuration, 'replaceSource');
  const reload = vi.fn(async () => 'reloaded' as const), restart = vi.fn();
  const freshStore = new SelfChangeStore({ root: join(f.projectRoot, '.zhin/changes'), projectRoot: f.projectRoot,
    protectedPaths: await createHostProtectedPaths({ projectRoot: f.projectRoot }) });
  const host = new HostSelfChangeApply({ projectRoot: f.projectRoot, configFile: f.configFile, configuration, reload, restart,
    snapshot: () => ({ generation: 2, tree: new Map() }) });
  const applier = new SelfChangeApplier({ projectRoot: f.projectRoot, store: freshStore, ports: { ...host.ports({
    emergencyStop: async () => undefined, report: async () => 'sent',
  }), health: async () => ({ ok: false, error: 'synthetic health failure' }) } });
  expect(await applier.recover()).toBe(1);
  if (scenario === 'owned') {
    expect(restore).toHaveBeenCalledExactlyOnceWith(f.initial, record.apply!.configRevision);
    expect(await readFile(f.configFile, 'utf8')).toBe(f.initial);
    await expect(readFile(join(f.projectRoot, 'commands/ping.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(applyConfiguration).toHaveBeenCalledTimes(1); expect(restart).toHaveBeenCalledTimes(1); expect(reload).not.toHaveBeenCalled();
    const recovering = await freshStore.get(record.id);
    expect(recovering?.status).toBe('verifying'); expect(recovering?.apply?.phase).toBe('rollback');
    expect(recovering?.apply?.configRevision).toBe((await configuration.readSource()).revision);
    return;
  }
  expect(await readFile(f.configFile, 'utf8')).toBe(source);
  expect(await readFile(join(f.projectRoot, 'commands/ping.ts'), 'utf8')).toContain('new');
  expect(applyConfiguration).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled();
  const failed = await freshStore.get(record.id);
  expect(failed?.status).toBe('failed'); expect(failed?.slimmed).toBe(false);
  expect(failed?.error).toContain(scenario === 'superseded' ? 'superseded' : 'unconfirmed');
});

// Upgrade across #1146: records persisted mid-flight by an older build carry a configPatch but no
// `apply.configRevision`. Recovery must not guess ownership: stop, keep evidence, ask for manual verification.
it.each([['applying', true], ['verifying', true], ['applying', false], ['verifying', false]] as const)('upgrade: a pre-#1146 %s record without configRevision recovers to failed for manual verification (config port=%s)', async (status, configPort) => {
  const f = await fixture({ files: true });
  const { revision, source: initial } = await f.configuration.readSource();
  await f.store.writeSnapshot(f.draft.id, { files: [{ path: 'commands/ping.ts', content: null }], config: { source: initial, revision } });
  // The older build already wrote the change before the process went away.
  await mkdir(join(f.projectRoot, 'commands'), { recursive: true });
  await writeFile(join(f.projectRoot, 'commands/ping.ts'), 'export default "new";\n');
  await writeFile(f.configFile, JSON.stringify({ configVersion: 2, plugins: {}, ai: { trigger: { ambient: { mode: 'active', quietMs: 100 } } } }));
  const legacyApply = { phase: 'forward' as const, mode: 'process' as const, restarts: 0, failure: null };
  await f.store.transition(f.draft.id, 'applying', { actor: 'policy', reasonCode: 'change_restart_requested', apply: legacyApply });
  if (status === 'verifying') await f.store.transition(f.draft.id, 'verifying', { actor: 'policy', apply: { ...legacyApply, restarts: 1 } });
  const before = (await f.store.get(f.draft.id))!;
  expect(before.status).toBe(status); expect(before.apply?.configRevision).toBeUndefined();
  const source = await readFile(f.configFile, 'utf8');

  const applyConfiguration = vi.fn(async (next?: string) => application(next!));
  const configuration = new ConsoleConfigurationStore({ projectRoot: f.projectRoot, document: createConfigDocument(f.configFile), applyConfiguration });
  const restore = vi.spyOn(configuration, 'replaceSource');
  const reload = vi.fn(async () => 'reloaded' as const), restart = vi.fn(), emergencyStop = vi.fn(async () => undefined);
  const events: DecisionEventInput[] = [];
  const freshStore = new SelfChangeStore({ root: join(f.projectRoot, '.zhin/changes'), projectRoot: f.projectRoot,
    protectedPaths: await createHostProtectedPaths({ projectRoot: f.projectRoot }), audit: () => ({ record: event => events.push(event) }) });
  const host = new HostSelfChangeApply({ projectRoot: f.projectRoot, configFile: f.configFile, reload, restart,
    ...(configPort ? { configuration } : {}), snapshot: () => ({ generation: 2, tree: new Map() }) });
  const applier = new SelfChangeApplier({ projectRoot: f.projectRoot, store: freshStore, ports: { ...host.ports({
    emergencyStop, report: async () => 'sent',
  }), health: async () => ({ ok: true }) } });
  expect(await applier.recover()).toBe(1);

  const failed = await freshStore.get(f.draft.id);
  expect(failed?.status).toBe('failed'); expect(failed?.slimmed).toBe(false);
  expect(failed?.error).toContain('unconfirmed'); expect(failed?.error).toContain('manual verification required');
  expect(failed?.apply?.configApplication).toBe('unconfirmed');
  // Terminal record `failed` (stopped for manual verification) while the decision outcome stays `defer`.
  expect(events.find(event => event.reasonCode === 'change_config_unconfirmed')?.outcome).toBe('defer');
  expect(restore).not.toHaveBeenCalled(); expect(applyConfiguration).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled(); expect(emergencyStop).not.toHaveBeenCalled();
  expect(await readFile(f.configFile, 'utf8')).toBe(source);
  expect(await readFile(join(f.projectRoot, 'commands/ping.ts'), 'utf8')).toBe('export default "new";\n');
  expect(await freshStore.readSnapshot(f.draft.id)).toMatchObject({ config: { revision } });
});
