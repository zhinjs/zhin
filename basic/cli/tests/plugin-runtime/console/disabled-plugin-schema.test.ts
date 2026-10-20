import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { calendarConfig } from '../../../../../plugins/utils/calendar/src/config.js';
import { reminderConfig } from '../../../../../plugins/utils/reminder/src/config.js';
import { repeaterConfig } from '../../../../../plugins/utils/repeater/src/config.js';

it('edits disabled built-in plugins from published static declarations without loading plugin code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhin-disabled-schemas-'));
  const helpers = { calendar: calendarConfig, reminder: reminderConfig, repeater: repeaterConfig };
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'disabled-schema-fixture', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    const plugins: Record<string, string> = {};
    for (const name of ['calendar', 'reminder', 'repeater', 'short-url']) {
      const packageRoot = resolve(import.meta.dirname, `../../../../../plugins/utils/${name}`);
      const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
      expect(manifest.files).toContain('schema.json');
      const source = await readFile(join(packageRoot, 'plugin.ts'), 'utf8');
      expect(source).not.toMatch(/\bconfig:\s*(?:\w+Config|Schema\.)/u);
      const raw = await readFile(join(packageRoot, 'schema.json'), 'utf8');
      if (name in helpers) expect(JSON.parse(raw)).toEqual(helpers[name as keyof typeof helpers].toJsonSchema());
      const target = join(root, name);
      await mkdir(target);
      await writeFile(join(target, 'package.json'), JSON.stringify({ name, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
      await writeFile(join(target, 'plugin.ts'), 'throw new Error("Disabled plugin must not execute for a config form")');
      await writeFile(join(target, 'schema.json'), raw);
      plugins[name] = `./${name}`;
    }
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins, disable_plugins: Object.keys(plugins) }));
    const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')), environmentForPlugin: () => ({ has: () => true }) });
    for (const key of Object.keys(plugins)) {
      expect(await store.readSchema(key), key).toMatchObject({ type: 'object' });
      expect((await store.readSource()).configPaths?.[key]).toEqual([key]);
      expect(await store.validatePluginConfig(key, {}), key).toMatchObject({ schemaAvailable: true, valid: true });
    }
    expect(await store.validatePluginConfig('repeater', { threshold: 1 })).toMatchObject({ valid: false });
    expect(await store.validatePluginConfig('reminder', { maxTasks: 100 })).toMatchObject({ valid: false });
    expect(await store.validatePluginConfig('calendar', { provider: 'unknown' })).toMatchObject({ valid: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});
