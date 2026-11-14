import { describe, expect, it } from 'vitest';
import { formatCompact } from '@zhin.js/logger';
import type { GenerationInvalidationPlan, HmrReloadReport, ProcessInvalidationPlan } from '@zhin.js/runtime';
import { describeHmrReloadLog, describeManifestIgnoredLog, describeRestartLog } from '../../src/instance/hmr-log.js';

const root = '/srv/bot';

function plan(overrides: Partial<GenerationInvalidationPlan>): GenerationInvalidationPlan {
  return {
    kind: 'generation', changed: [], manifestSources: [], slots: [], subtrees: [], fallbacks: [], reasons: [],
    ...overrides,
  };
}

describe('hmr_reload log (#1250)', () => {
  it('reports a whole-Root rebuild behind an AGENTS.md change instead of claiming a capability reload', () => {
    const report: HmrReloadReport = {
      kind: 'reloaded', rebuilt: 'root',
      plugins: ['root', 'root/icqq', 'root/qq', 'root/speech'] as HmrReloadReport['plugins'],
      capabilities: [],
      reason: 'changed Root Plugin files are not a convention capability: /srv/bot/AGENTS.md',
    };
    const log = describeHmrReloadLog(root, plan({
      changed: ['/srv/bot/AGENTS.md'],
      fallbacks: [{ source: '/srv/bot/AGENTS.md', owners: ['root' as never] }],
    }), 7, 13759, report);
    expect(formatCompact(log.info)).toBe(
      'hmr_reload | generation: 7 | duration_ms: 13759 | scope: capability | rebuilt: root | changed: AGENTS.md'
      + ' | rebuilt_plugins: root,root/icqq,root/qq,root/speech',
    );
    expect(log.warn).toMatchObject({
      op: 'hmr_full_rebuild', planned: 'capability',
      reason: 'changed Root Plugin files are not a convention capability: /srv/bot/AGENTS.md',
      rebuilt_plugins: 'root,root/icqq,root/qq,root/speech',
    });
  });

  it('keeps a capability swap quiet and lists the replaced capabilities', () => {
    const capability = ['root/weather', 'zhin.command', 'query'].join('\0');
    const log = describeHmrReloadLog(root, plan({ changed: ['/srv/bot/plugins/weather/src/wttr.ts'], slots: [capability as never] }), 3, 140, {
      kind: 'reloaded', rebuilt: 'capability', plugins: [], capabilities: [capability as never],
    });
    expect(formatCompact(log.info)).toBe(
      'hmr_reload | generation: 3 | duration_ms: 140 | scope: capability | rebuilt: capability'
      + ' | changed: plugins/weather/src/wttr.ts | capabilities: root/weather:zhin.command:query',
    );
    expect(log.warn).toBeUndefined();
  });

  it('warns when a multi-file subtree plan degrades to a whole-Root rebuild', () => {
    const log = describeHmrReloadLog(root, plan({
      changed: ['/srv/bot/plugins/qq-ops/plugin.ts', '/srv/bot/plugins/weather/src/wttr.ts'],
      subtrees: ['root/qq-ops' as never],
    }), 6, 14241, {
      kind: 'reloaded', rebuilt: 'root', plugins: ['root', 'root/icqq'] as HmrReloadReport['plugins'], capabilities: [],
      reason: 'a subtree reload only covers Plugin entry / schema changes; other changed sources: /srv/bot/plugins/weather/src/wttr.ts',
    });
    expect(log.info).toMatchObject({ scope: 'subtree', rebuilt: 'root', subtrees: 'root/qq-ops' });
    expect(log.warn).toMatchObject({ planned: 'subtree', rebuilt_plugins: 'root,root/icqq' });
  });

  it('does not warn when the plan itself asked for the Root', () => {
    const log = describeHmrReloadLog(root, plan({ changed: ['/srv/bot/plugin.ts'], subtrees: ['root' as never] }), 2, 10, {
      kind: 'reloaded', rebuilt: 'root', plugins: ['root'] as HmrReloadReport['plugins'], capabilities: [],
    });
    expect(log.info).toMatchObject({ scope: 'root', rebuilt: 'root' });
    expect(log.warn).toBeUndefined();
  });
});

describe('hmr_reload resource and stale-dependent records (#1250)', () => {
  it('reports a declared project file as a resource reload, without a full-rebuild warning', () => {
    const log = describeHmrReloadLog(root, plan({
      changed: ['/srv/bot/AGENTS.md'],
      fallbacks: [{ source: '/srv/bot/AGENTS.md', owners: ['root' as never] }],
    }), 7, 3, { kind: 'reloaded', rebuilt: 'resource', plugins: [], capabilities: [], resources: ['/srv/bot/AGENTS.md'] });
    expect(formatCompact(log.info)).toBe(
      'hmr_reload | generation: 7 | duration_ms: 3 | scope: resource | rebuilt: resource | changed: AGENTS.md | resources: AGENTS.md',
    );
    expect(log.warn).toBeUndefined();
    expect(log.staleWarn).toBeUndefined();
  });

  it('lists importers the reload could not refresh', () => {
    const log = describeHmrReloadLog(root, plan({
      changed: ['/srv/bot/packages/shared/value.ts'],
      subtrees: ['root/weather' as never],
      unrefreshedDependents: ['/srv/bot/tools/lookup/index.ts'],
    }), 4, 20, { kind: 'reloaded', rebuilt: 'subtree', plugins: ['root/weather'] as HmrReloadReport['plugins'], capabilities: [] });
    expect(log.info).toMatchObject({ unrefreshed_dependents: 'tools/lookup/index.ts' });
    expect(log.staleWarn).toMatchObject({
      op: 'hmr_unrefreshed_dependents', changed: 'packages/shared/value.ts', dependents: 'tools/lookup/index.ts',
    });
  });
});

describe('instance_restart log (#1250)', () => {
  it('names the manifest, its changed fields and the runtime-relevant ones', () => {
    const restart: ProcessInvalidationPlan = {
      kind: 'process', changed: ['/srv/bot/package.json'], reasons: ['package runtime ABI changed: bot'],
      manifestChanges: [{ source: '/srv/bot/package.json', fields: ['scripts', 'type'], runtimeFields: ['type'] }],
    };
    expect(formatCompact(describeRestartLog(root, restart))).toBe(
      'instance_restart | reason: manifest_changed | file: package.json | fields: scripts,type | runtime_fields: type'
      + ' | changed: package.json | detail: package runtime ABI changed: bot',
    );
  });

  it('classifies lockfile and environment restarts', () => {
    expect(describeRestartLog(root, { kind: 'process', changed: ['/srv/bot/pnpm-lock.yaml'], reasons: ['workspace dependency state changed'] }))
      .toMatchObject({ reason: 'dependencies_changed', file: 'pnpm-lock.yaml' });
    expect(describeRestartLog(root, { kind: 'process', changed: ['/srv/bot/.env'], reasons: ['Module loader cannot safely invalidate: /srv/bot/.env'] }))
      .toMatchObject({ reason: 'environment_changed', changed: '.env' });
  });

  it('describes an ignored manifest edit for the debug log', () => {
    expect(formatCompact(describeManifestIgnoredLog(root, { source: '/srv/bot/package.json', fields: ['scripts'], runtimeFields: [] })))
      .toBe('manifest_change_ignored | file: package.json | fields: scripts | reason: no runtime-relevant field changed');
  });
});
