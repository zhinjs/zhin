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
