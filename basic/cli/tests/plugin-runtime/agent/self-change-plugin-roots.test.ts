import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SelfChangeApplier,
  SelfChangePathError,
  SelfChangeStore,
  createHostProtectedPaths,
  type SelfChangeApplyPorts,
  type SelfChangeOrigin,
} from '@zhin.js/agent';
import {
  createSelfChangePluginRoots,
  localPluginRoots,
  type LocalPluginRootSource,
} from '../../../src/plugin-runtime/agent/self-change-plugin-roots.js';

const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'private:42', userId: '42', endpoint: 'bot-1' };

let project: string;
let outside: string;

beforeEach(() => {
  // realpath: macOS tmpdir() is a symlink (/var → /private/var); watch roots are real paths.
  project = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-plugin-roots-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-plugin-roots-outside-')));
  for (const directory of ['plugins/weather/commands', 'packages/helper', 'node_modules/zhin-plugin-x/commands']) {
    mkdirSync(join(project, directory), { recursive: true });
  }
  symlinkSync(join(project, 'node_modules', 'zhin-plugin-x'), join(project, 'plugins', 'linked'));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function ownership(roots: readonly string[]): LocalPluginRootSource {
  return { watchRoots: () => roots.map(root => ({ root, source: 'workspace' as const })) };
}

function projectOwnership(): LocalPluginRootSource {
  return ownership([
    project,
    join(project, 'plugins', 'weather'),
    join(project, 'packages', 'helper'),
    join(project, 'plugins', 'linked'),
    join(project, 'node_modules', 'zhin-plugin-x'),
    outside,
    join(project, 'plugins', 'missing'),
  ]);
}

describe('localPluginRoots (#1051 F1)', () => {
  it('keeps local roots under the project root as relative posix paths', () => {
    const roots = localPluginRoots(project, projectOwnership());
    expect(roots).toEqual(['packages/helper', 'plugins/weather']);
    expect(Object.isFrozen(roots)).toBe(true);
  });

  it('is empty without source ownership', () => {
    expect(localPluginRoots(project, undefined)).toEqual([]);
  });

  it('re-reads the committed ownership and caches per ownership index', () => {
    const committed: { ownership?: LocalPluginRootSource } = {};
    const provider = createSelfChangePluginRoots(project, () => committed.ownership);
    expect(provider()).toEqual([]);
    committed.ownership = projectOwnership();
    const first = provider();
    expect(first).toEqual(['packages/helper', 'plugins/weather']);
    expect(provider()).toBe(first);
    committed.ownership = ownership([join(project, 'plugins', 'weather')]);
    expect(provider()).toEqual(['plugins/weather']);
  });
});

describe('self-change wiring with local plugin roots (#1051 F1)', () => {
  async function makeStore(pluginRoots: () => readonly string[]) {
    return new SelfChangeStore({
      root: join(project, '.zhin', 'changes'),
      projectRoot: project,
      protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
      pluginRoots,
    });
  }

  it('drafts into a local plugin convention dir and refuses node_modules plugins', async () => {
    const store = await makeStore(createSelfChangePluginRoots(project, () => projectOwnership()));
    const draft = await store.draft({ origin, files: [{ path: 'plugins/weather/commands/now.ts', content: 'export default 1;\n' }] });
    expect(draft.files.map(file => file.path)).toEqual(['plugins/weather/commands/now.ts']);
    await expect(store.draft({ origin, files: [{ path: 'node_modules/zhin-plugin-x/commands/a.ts', content: 'x' }] }))
      .rejects.toBeInstanceOf(SelfChangePathError);
    await expect(store.draft({ origin, files: [{ path: 'plugins/linked/commands/a.ts', content: 'x' }] }))
      .rejects.toBeInstanceOf(SelfChangePathError);
  });

  it('refuses a local plugin path until the generation lists the plugin root', async () => {
    const committed: { ownership?: LocalPluginRootSource } = {};
    const store = await makeStore(createSelfChangePluginRoots(project, () => committed.ownership));
    const file = { path: 'plugins/weather/commands/now.ts', content: 'export default 1;\n' };
    await expect(store.draft({ origin, files: [file] })).rejects.toBeInstanceOf(SelfChangePathError);
    committed.ownership = projectOwnership();
    await expect(store.draft({ origin, files: [file] })).resolves.toMatchObject({ status: 'draft' });
  });

  it('the applier writes into the local plugin root it shares with the store', async () => {
    const pluginRoots = createSelfChangePluginRoots(project, () => projectOwnership());
    const store = await makeStore(pluginRoots);
    const draft = await store.draft({ origin, files: [{ path: 'plugins/weather/commands/now.ts', content: 'export default "now";\n' }] });
    await store.attachPlan(draft.id, draft.contentHash, {
      version: 1,
      contentHash: draft.contentHash,
      summary: 'now',
      files: [],
      impact: { kind: 'generation', subtrees: ['weather'], slots: [], reasons: [], estimated: false, config: null },
    });
    await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
    await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
    await store.transition(draft.id, 'pending', { actor: 'policy' });
    await store.transition(draft.id, 'approved', { actor: 'operator', actorId: '42', approvedBy: '42' });
    const reloaded: string[][] = [];
    const ports: SelfChangeApplyPorts = {
      reload: async ({ changed }) => {
        reloaded.push([...changed]);
        return 'reloaded';
      },
      requestRestart: () => undefined,
      health: async () => ({ ok: true }),
      emergencyStop: async () => undefined,
      report: async () => 'sent',
    };
    const applier = new SelfChangeApplier({ store, projectRoot: project, protectedPaths: await createHostProtectedPaths({ projectRoot: project }), pluginRoots, ports });
    expect(await applier.apply(draft.id)).toBe('applied');
    expect(reloaded).toEqual([['plugins/weather/commands/now.ts']]);
    expect(readFileSync(join(project, 'plugins', 'weather', 'commands', 'now.ts'), 'utf8')).toBe('export default "now";\n');
  });
});
