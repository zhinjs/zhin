import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSourcePluginOrder } from '@zhin.js/config-file';
import { applyDatabaseToConfig } from '@zhin.js/scaffold-wizard';
import { prepareConfigSave, readConfig, saveConfig } from '../src/utils/config-file.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(source = 'configVersion: 2\nplugins: {}\nhttp:\n  port: 8080\n') {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-revision-'));
  roots.push(root);
  const file = join(root, 'zhin.config.yml');
  await writeFile(file, source);
  return file;
}

it('returns an editable loaded document and supports setup adding database configuration', async () => {
  const file = await fixture();
  const config = await readConfig(file);
  expect(Object.isFrozen(config)).toBe(false);
  applyDatabaseToConfig(config, { dialect: 'sqlite', filename: 'data/bot.db' });
  await saveConfig(file, config);
  expect((await readConfig(file)).database).toMatchObject({ dialect: 'sqlite', filename: 'data/bot.db' });
  // A second mutation of the same editable object uses its successful saved revision.
  config.log_level = 'DEBUG';
  await saveConfig(file, config);
  expect((await readConfig(file)).log_level).toBe('DEBUG');
  expect(JSON.stringify(config)).not.toContain('snapshot');
});

it('refuses stale saves when values, comments or declaration source order changed', async () => {
  const source = 'configVersion: 2\nplugins:\n  "10": ten\n  "2": two\nhttp:\n  port: 8080\n';
  for (const external of [source.replace('8080', '9000'), `# external comment\n${source}`, source.replace('  "10": ten\n  "2": two', '  "2": two\n  "10": ten')]) {
    const file = await fixture(source);
    const config = await readConfig(file);
    config.http = { port: 8090 };
    await writeFile(file, external);
    await expect(saveConfig(file, config)).rejects.toThrow('changed since it was read');
    expect(await readFile(file, 'utf8')).toBe(external);
  }
});

it('supports cloned fix candidates using an explicit original base and rejects drift even on no-op prepare', async () => {
  const file = await fixture();
  const original = await readConfig(file);
  const fixed = structuredClone(original);
  fixed.log_level = 'DEBUG';
  await writeFile(file, '# external\nconfigVersion: 2\nplugins: {}\n');
  await expect(saveConfig(file, fixed, original)).rejects.toThrow('changed since it was read');
  await expect(prepareConfigSave(file, original)).rejects.toThrow('changed since it was read');
});

it('prepares inertly, preserves source order and refuses post-prepare edits at commit', async () => {
  const file = await fixture('configVersion: 2\nplugins:\n  "10": ten\n  "2": two\n"10":\n  token: "${TOKEN}" # literal\n"2": {}\n');
  const before = await readFile(file, 'utf8');
  const config = await readConfig(file);
  config.log_level = 'INFO';
  const prepared = await prepareConfigSave(file, config);
  expect(await readFile(file, 'utf8')).toBe(before);
  expect(prepared?.pluginOrder).toEqual(['10', '2']);
  await prepared?.commit();
  expect(readSourcePluginOrder(await readFile(file, 'utf8'), 'YAML')).toEqual(['10', '2']);
  const next = await readConfig(file); next.log_level = 'DEBUG';
  const conflict = await prepareConfigSave(file, next);
  const external = `${await readFile(file, 'utf8')}# user edit\n`;
  await writeFile(file, external);
  await expect(conflict?.commit()).rejects.toThrow('changed since it was read');
  expect(await readFile(file, 'utf8')).toBe(external);
});
