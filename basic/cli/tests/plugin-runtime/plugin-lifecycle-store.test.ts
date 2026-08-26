import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  createPluginLifecycleStore,
  readPluginLifecycleState,
  resolvePluginLifecycleFile,
} from '../../src/plugin-runtime/plugin-lifecycle-store.js';

const declared = [{packageName: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox'}] as const;

describe('plugin lifecycle store', () => {
  it('persists disabled instances atomically and re-enables them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-lifecycle-'));
    const file = join(root, 'plugin-lifecycle.json');
    const store = createPluginLifecycleStore();
    expect(await store.setPluginEnabled(file, 'sandbox', false, declared)).toMatchObject({disabled: ['sandbox']});
    expect(await readPluginLifecycleState(file)).toMatchObject({disabled: ['sandbox']});
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({schemaVersion: 1, disabled: ['sandbox']});
    expect((await stat(file)).mode & 0o077).toBe(0);
    expect(await store.setPluginEnabled(file, 'sandbox', true, declared)).toMatchObject({disabled: []});
    store.dispose();
  });

  it('rejects unknown plugins and relative external lifecycle paths', async () => {
    const store = createPluginLifecycleStore();
    await expect(store.setPluginEnabled('/tmp/unused.json', 'unknown', false, declared)).rejects.toThrow('Unknown plugin');
    store.dispose();
    expect(() => resolvePluginLifecycleFile('/project', {ZHIN_PLUGIN_LIFECYCLE_FILE: 'relative.json'})).toThrow('must be absolute');
  });
});
