import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPluginLifecycleStore, readProjectPluginLifecycleState, resolvePluginLifecycleFile, readDeclaredPlugins} from '../../src/plugin-runtime/plugin-lifecycle-store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))); });
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-lifecycle-')); roots.push(root);
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({configVersion: 2, plugins: {sandbox: '@zhin.js/adapter-sandbox', second: '@zhin.js/adapter-sandbox'}, sandbox: {token: '${TOKEN}'}, second: {}}));
  return root;
}
describe('application plugin lifecycle authority', () => {
  it('writes only disable_plugins and preserves declarations and unfinished business configuration', async () => {
    const root = await project();
    const file = resolvePluginLifecycleFile(root);
    const store = createPluginLifecycleStore(root);
    const declared = await readDeclaredPlugins(root);
    await Promise.all([store.setPluginEnabled(file, 'sandbox', false, declared), store.setPluginEnabled(file, 'second', false, declared)]);
    expect(await readProjectPluginLifecycleState(root, file)).toMatchObject({disabled: ['sandbox', 'second']});
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toMatchObject({plugins: {sandbox: '@zhin.js/adapter-sandbox', second: '@zhin.js/adapter-sandbox'}, sandbox: {token: '${TOKEN}'}, disable_plugins: ['sandbox', 'second']});
    await expect(readFile(file)).rejects.toMatchObject({code: 'ENOENT'});
    await store.setPluginEnabled(file, 'sandbox', true, declared);
    expect(await readProjectPluginLifecycleState(root, file)).toMatchObject({disabled: ['second']});
    store.dispose();
  });

  it('rejects unknown instances without creating a sidecar or changing application bytes', async () => {
    const root = await project(); const file = join(root, 'zhin.config.json'); const before = await readFile(file, 'utf8');
    const store = createPluginLifecycleStore(root);
    await expect(store.setPluginEnabled(resolvePluginLifecycleFile(root), 'unknown', false, await readDeclaredPlugins(root))).rejects.toThrow('Unknown plugin');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(() => resolvePluginLifecycleFile('/project', {ZHIN_PLUGIN_LIFECYCLE_FILE: 'relative.json'})).toThrow('must be absolute');
  });

  it('rejects legacy lifecycle intent rather than combining two enabled-state authorities', async () => {
    const root = await project(); const legacy = join(root, 'legacy.json');
    await writeFile(legacy, JSON.stringify({schemaVersion: 1, disabled: ['sandbox']}));
    await expect(readProjectPluginLifecycleState(root, legacy)).rejects.toThrow(/migrate instances/);
  });
});
