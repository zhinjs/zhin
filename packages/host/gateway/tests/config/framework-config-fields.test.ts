import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../src/config/configuration.js';

// #1250 `plugin-status-ignores-framework-config-keys`: `zhin packages status weather` reported
// `missing-config` (`$.commandNamespace 不支持的字段`) while `zhin config check` passed, because the
// gateway validated against the raw schema.json and Runtime against the schema with the framework fields.
it('accepts the framework fields Runtime adds to a closed plugin schema, and still rejects unknown fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhin-framework-config-fields-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'framework-fields-fixture', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    const target = join(root, 'weather');
    await mkdir(target);
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'weather', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(target, 'plugin.ts'), 'export default {};');
    await writeFile(join(target, 'schema.json'), JSON.stringify({
      type: 'object', additionalProperties: false, properties: { city: { type: 'string' } },
    }));
    const config = { configVersion: 2, plugins: { weather: './weather' }, weather: { city: '上海', commandNamespace: 'tq', disabledCommands: ['forecast'] } };
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(config));
    const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')), environmentForPlugin: () => ({ has: () => true }) });

    expect(await store.validatePluginConfig('weather', config.weather)).toMatchObject({ schemaAvailable: true, valid: true, errors: [] });
    const invalid = await store.validatePluginConfig('weather', { ...config.weather, commandNamespace: '', extra: 1 });
    expect(invalid.valid).toBe(false);
    expect([...new Set(invalid.errors.map(error => error.path))].sort()).toEqual(['$.commandNamespace', '$.extra']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Runtime composition adds a Plugin's child Plugins (`package.json#zhin.plugins`) to its schema and
// reads their blocks from inside the parent's block; closing an open schema must not reject them.
it('accepts the nested blocks of child Plugins in a parent schema without additionalProperties', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhin-framework-config-children-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'framework-children-fixture', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    const target = join(root, 'weather');
    await mkdir(join(target, 'radar'), { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'weather', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [{ package: './radar', instanceKey: 'radar' }] } }));
    await writeFile(join(target, 'plugin.ts'), 'export default {};');
    await writeFile(join(target, 'schema.json'), JSON.stringify({ type: 'object', properties: { city: { type: 'string' } } }));
    await writeFile(join(target, 'radar', 'package.json'), JSON.stringify({ name: 'radar', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(target, 'radar', 'plugin.ts'), 'export default {};');
    const config = { configVersion: 2, plugins: { weather: './weather' }, weather: { city: '上海', radar: { range: 3 } } };
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(config));
    const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')), environmentForPlugin: () => ({ has: () => true }) });

    expect(await store.validatePluginConfig('weather', config.weather)).toMatchObject({ valid: true, errors: [] });
    const invalid = await store.validatePluginConfig('weather', { ...config.weather, extra: 1 });
    expect(invalid.errors.map(error => error.path)).toEqual(['$.extra']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
