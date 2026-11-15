import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyConfigPatches, definePlugin,
  type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch, type PreparedConfigDocument, type RuntimeConfigDocument, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import middlewareFeature, { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '@zhin.js/middleware';
import toolFeature, { ToolIndex, defineAgentTool, toolFeatureId } from '@zhin.js/tool';
import pageFeature, { PageIndex, pageFeatureId } from '@zhin.js/page';
import { ManifestValidationError, parsePackageJson, RootRuntime, type ModuleRuntime, type ZhinPluginManifest } from '../src/index.js';

/**
 * zhinjs/zhin#1250: enabling / disabling an ordinary (non-adapter) plugin instance through
 * `disable_plugins` is one generation transaction in the running Runtime — the same path a
 * Console configuration apply takes — so its commands, middlewares, tools and pages appear and
 * disappear without a process restart, while sibling instances keep their Scope.
 */
const temporary: string[] = [];
const running: RootRuntime[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(runtime => runtime.stop().catch(() => undefined)));
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('hot plugin enable / disable', () => {
  it('retires and re-assembles a plugin instance with its commands, middlewares, tools and pages', async () => {
    const f = await fixture({ configVersion: 2, plugins: { game: '@test/game', keeper: '@test/keeper' }, game: {}, keeper: {} });
    const runtime = f.runtime();
    const first = await runtime.start();
    expect(capabilities(first)).toEqual({ game: true, command: true, middleware: true, tool: true, page: true });
    expect(f.setups).toEqual(['root', 'game', 'keeper']);

    // Disable: the file changes (as the gateway writes it), then the configuration is applied.
    f.document.replace({ ...f.document.document, disable_plugins: ['game'] });
    const disabled = await runtime.applyConfiguration(f.document.revisionId);
    expect(disabled.generation).toBe(2);
    expect(capabilities(runtime.snapshot)).toEqual({ game: false, command: false, middleware: false, tool: false, page: false });
    expect(f.disposed).toEqual(['game']);
    await expect((runtime.snapshot.projections.get(commandFeatureId) as CommandIndex).execute('keep')).resolves.toBe('kept');
    // The sibling's Scope was kept: no second setup.
    expect(f.setups.filter(key => key === 'keeper')).toHaveLength(1);

    // Enable again: assembled and committed in place.
    f.document.replace({ ...f.document.document, disable_plugins: [] });
    await runtime.applyConfiguration(f.document.revisionId);
    expect(runtime.snapshot.generation).toBe(3);
    expect(capabilities(runtime.snapshot)).toEqual({ game: true, command: true, middleware: true, tool: true, page: true });
    await expect((runtime.snapshot.projections.get(commandFeatureId) as CommandIndex).execute('roll')).resolves.toBe('rolled');
    expect(f.setups.filter(key => key === 'game')).toHaveLength(2);
    expect(f.setups.filter(key => key === 'keeper')).toHaveLength(1);
    // The previous generation's lease still saw the capabilities while it was current.
    expect(capabilities(first)).toEqual({ game: true, command: true, middleware: true, tool: true, page: true });
  });

  it('keeps the committed generation when enabling a plugin fails its setup', async () => {
    const f = await fixture({ configVersion: 2, plugins: { game: '@test/game', keeper: '@test/keeper' }, disable_plugins: ['game'], game: {}, keeper: {} });
    f.failGame = true;
    const runtime = f.runtime();
    await runtime.start();
    expect(capabilities(runtime.snapshot).game).toBe(false);
    f.document.replace({ ...f.document.document, disable_plugins: [] });
    await expect(runtime.applyConfiguration(f.document.revisionId)).rejects.toThrow('game setup failed');
    expect(runtime.snapshot.generation).toBe(1);
    expect(capabilities(runtime.snapshot)).toEqual({ game: false, command: false, middleware: false, tool: false, page: false });
  });
});

describe('package.json#zhin.toggle', () => {
  const parse = (toggle: unknown) => parsePackageJson({ name: '@test/p', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', toggle } }, 'package.json').zhin as ZhinPluginManifest;
  it('accepts hot / restart, omits it when absent and rejects anything else', () => {
    expect(parse('restart').toggle).toBe('restart');
    expect(parse('hot').toggle).toBe('hot');
    expect('toggle' in parse(undefined)).toBe(false);
    expect(() => parse('never')).toThrow(ManifestValidationError);
  });
});

function capabilities(snapshot: RuntimeSnapshot) {
  // Only the game plugin mounts these Features: once it is retired the projections are gone too.
  const commands = snapshot.projections.get(commandFeatureId) as CommandIndex | undefined;
  const middlewares = snapshot.projections.get(middlewareFeatureId) as MiddlewareIndex | undefined;
  const tools = snapshot.projections.get(toolFeatureId) as ToolIndex | undefined;
  const pages = snapshot.projections.get(pageFeatureId) as PageIndex | undefined;
  return {
    game: [...snapshot.tree.values()].some(node => node.instanceKey === 'game'),
    command: commands?.has('roll') ?? false,
    middleware: middlewares?.list().some(item => String(item.owner) === 'root/game') ?? false,
    tool: tools?.list().some(item => item.name === 'dice' && String(item.owner) === 'root/game') ?? false,
    page: pages?.list().some(item => item.title === 'Board') ?? false,
  };
}

async function fixture(initial: RuntimeConfigDocument) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-plugin-hot-toggle-')));
  temporary.push(root);
  const features = ['command', 'middleware', 'tool', 'page'];
  const rootManifest = { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], platformFeatures: false };
  await json(join(root, 'package.json'), { name: '@test/root', dependencies: { '@test/game': 'workspace:*', '@test/keeper': 'workspace:*' }, zhin: rootManifest });
  for (const name of features) {
    await json(join(root, `packages/${name}/package.json`), { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' } });
    await touch(join(root, `packages/${name}/index.ts`));
  }
  await json(join(root, 'plugins/game/package.json'), {
    name: '@test/game',
    dependencies: Object.fromEntries(features.map(name => [`@test/${name}`, 'workspace:*'])),
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', platformFeatures: false, features: features.map(name => ({ package: `@test/${name}`, api: '^1.0.0' })) },
  });
  // The sibling shares the Command Feature: the index stays, only the game's command leaves it.
  await json(join(root, 'plugins/keeper/package.json'), { name: '@test/keeper', dependencies: { '@test/command': 'workspace:*' },
    zhin: { ...rootManifest, features: [{ package: '@test/command', api: '^1.0.0' }] } });
  await touch(join(root, 'plugins/keeper/commands/keep/index.ts'));
  const game = (path: string) => join(root, 'plugins/game', path);
  for (const file of ['plugin.ts', 'commands/roll/index.ts', 'middlewares/trace/index.ts', 'tools/dice/index.ts', 'pages/board/index.tsx']) await touch(game(file));
  await touch(join(root, 'plugin.ts'));
  await touch(join(root, 'plugins/keeper/plugin.ts'));
  const setups: string[] = [];
  const disposed: string[] = [];
  const state = { failGame: false };
  const modules = new FakeModules();
  modules.set(join(root, 'plugin.ts'), { default: definePlugin({ name: 'root', setup: context => { setups.push(context.plugin.instanceKey); } }) });
  modules.set(join(root, 'plugins/keeper/plugin.ts'), { default: definePlugin({ name: 'keeper', setup: context => { setups.push(context.plugin.instanceKey); } }) });
  modules.set(game('plugin.ts'), { default: definePlugin({ name: 'game', setup: context => {
    if (state.failGame) throw new Error('game setup failed');
    setups.push(context.plugin.instanceKey);
    return () => { disposed.push(context.plugin.instanceKey); };
  } }) });
  modules.set(join(root, 'packages/command/index.ts'), { default: commandFeature });
  modules.set(join(root, 'packages/middleware/index.ts'), { default: middlewareFeature });
  modules.set(join(root, 'packages/tool/index.ts'), { default: toolFeature });
  modules.set(join(root, 'packages/page/index.ts'), { default: pageFeature });
  modules.set(join(root, 'plugins/keeper/commands/keep/index.ts'), { default: defineCommand({ execute: () => 'kept' }) });
  modules.set(game('commands/roll/index.ts'), { default: defineCommand({ execute: () => 'rolled' }) });
  modules.set(game('middlewares/trace/index.ts'), { default: defineMiddleware<string[]>({ async handle({ input }, next) { input.push('trace'); await next(); } }) });
  modules.set(game('tools/dice/index.ts'), { default: defineAgentTool({ description: 'Dice', execute: () => 4 }) });
  modules.setClient(game('pages/board/index.tsx'), Object.freeze({ module: '/board.js', hash: 'v1', metadata: { title: 'Board' } }));
  const document = new MemoryDocument(join(root, 'zhin.config.json'), initial);
  return {
    root, setups, disposed, document,
    set failGame(value: boolean) { state.failGame = value; },
    runtime() {
      const runtime = new RootRuntime({ projectRoot: root, config: document, modules, environment: { name: 'test', mode: 'test', platform: 'node' } });
      running.push(runtime);
      return runtime;
    },
  };
}

class MemoryDocument implements ConfigDocumentPort {
  readonly sources: readonly string[];
  document: RuntimeConfigDocument;
  revision = 0;
  constructor(source: string, document: RuntimeConfigDocument) { this.sources = [source]; this.document = structuredClone(document); }
  get revisionId(): string { return String(this.revision); }
  async read(): Promise<ConfigDocumentSnapshot> { return { document: structuredClone(this.document), revision: String(this.revision) }; }
  replace(document: RuntimeConfigDocument): void { this.document = structuredClone(document); this.revision += 1; }
  async prepare(current: ConfigDocumentSnapshot, patches: readonly ConfigPatch[]): Promise<PreparedConfigDocument> {
    const document = applyConfigPatches(current.document, patches);
    return { document, commit: async () => { this.replace(document); return this.read(); }, rollback: async () => undefined };
  }
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #client = new Map<string, unknown>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  setClient(source: string, value: unknown): void { this.#client.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }
  async loadClientModule<T>(source: string, _request: ClientModuleRequest): Promise<T> {
    const value = this.#client.get(source);
    if (!value) throw new Error(`Missing client artifact: ${source}`);
    return value as T;
  }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
