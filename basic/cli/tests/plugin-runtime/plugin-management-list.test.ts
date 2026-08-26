import {mkdtemp, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildManagedPluginList} from '../../src/plugin-runtime/console-api-installer.js';
import {createPluginLifecycleStore} from '../../src/plugin-runtime/plugin-lifecycle-store.js';

describe('Console managed plugin list', () => {
  it('keeps a declared disabled plugin visible and manageable while absent from the snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-managed-plugin-list-'));
    const lifecycle = join(root, 'plugin-lifecycle.json');
    const declared = [{packageName: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox'}] as const;
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'root',
      zhin: {plugins: [{package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox'}]},
    }));
    const store = createPluginLifecycleStore();
    await store.setPluginEnabled(lifecycle, 'sandbox', false, declared);
    store.dispose();
    await expect(buildManagedPluginList(root, lifecycle)).resolves.toEqual([{
      name: 'sandbox',
      status: 'inactive',
      description: '@zhin.js/adapter-sandbox · 已停用',
      features: [],
      packageName: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
      manageable: true,
    }]);
  });
});
