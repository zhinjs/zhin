import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import commandFeature, { commandFeatureId, defineCommand } from '@zhin.js/command';
import { definePlugin, type DatabaseHost } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { installLocaleHost } from '../../src/plugin-runtime/locale-host-installer.js';
class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> { if (!this.values.has(source)) throw new Error(`Missing ${source}`); return this.values.get(source) as T; }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {} async close(): Promise<void> {}
}
const noDatabase: DatabaseHost = { dialect: 'memory', started: false, define: vi.fn(), tables: () => [], models: { get: () => undefined }, getRawDatabase: () => undefined, start: async () => {}, stop: async () => {} };
it('locale host does not register a root command when only a child mounts command Feature', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'locale-audit-')));
  const modules = new Modules();
  const write = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  await write(join(directory,'package.json'), { name: '@test/root', dependencies: { '@test/child': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry:'./plugin.ts' } });
  await write(join(directory,'plugin.ts'), ''); modules.values.set(join(directory,'plugin.ts'), { default:definePlugin({name:'root'}) });
  await write(join(directory,'packages/child/package.json'), { name:'@test/child', dependencies:{ '@test/command':'workspace:*' }, zhin:{protocol:1,type:'plugin',entry:'./plugin.ts',features:[{package:'@test/command'}]} });
  await write(join(directory,'packages/child/plugin.ts'), ''); modules.values.set(join(directory,'packages/child/plugin.ts'),{default:definePlugin({name:'child'})});
  await write(join(directory,'packages/child/commands/check/index.ts'), ''); modules.values.set(join(directory,'packages/child/commands/check/index.ts'),{default:defineCommand({execute:()=> 'ok'})});
  await write(join(directory,'packages/command/package.json'), {name:'@test/command',zhin:{protocol:1,type:'feature',entry:'./index.ts'}});
  await write(join(directory,'packages/command/index.ts'), ''); modules.values.set(join(directory,'packages/command/index.ts'),{default:commandFeature});
  const runtime = new RootRuntime({projectRoot:directory,modules,config:{configVersion:2,plugins:{child:'@test/child'}},environment:{name:'test',mode:'test',platform:'node'},installResources:installLocaleHost(noDatabase)});
  try { await runtime.start(); expect(runtime.snapshot.projections.has(commandFeatureId)).toBe(true);
    expect([...runtime.snapshot.capabilities.values()].map(slot => slot.localName)).toEqual(['check']); }
  finally { await runtime.stop(); await rm(directory,{recursive:true,force:true}); }
});
