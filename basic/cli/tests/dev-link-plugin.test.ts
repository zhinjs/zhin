import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PLUGIN_LINK_STATE,
  defaultInstanceKey,
  devLinkPlugin,
  devUnlinkPlugin,
  findSharedZhinCopies,
  isZhinPluginDirectory,
  linkedPluginKeys,
} from '../src/utils/dev-link-plugin.js';

let root: string, bot: string, plugin: string, logs: string[];
const log = (message: string) => logs.push(message);
const config = () => JSON.parse(fs.readFileSync(path.join(bot, 'zhin.config.json'), 'utf8'));
const writePkg = (dir: string, manifest: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-link-plugin-'));
  bot = path.join(root, 'bot');
  plugin = path.join(root, 'glossary');
  writePkg(bot, { name: 'bot' });
  fs.writeFileSync(path.join(bot, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' } }, null, 2));
  writePkg(plugin, { name: 'zhin-plugin-glossary', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js' } });
  logs = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('zhin dev link <plugin dir>', () => {
  it('recognises plugin directories and derives the instance key', () => {
    expect(isZhinPluginDirectory(plugin)).toBe(true);
    expect(isZhinPluginDirectory(bot)).toBe(false);
    writePkg(path.join(root, 'exports-only'), { name: 'x', exports: { './zhin': './plugin.js' } });
    expect(isZhinPluginDirectory(path.join(root, 'exports-only'))).toBe(true);
    expect(defaultInstanceKey('zhin-plugin-glossary')).toBe('glossary');
    expect(defaultInstanceKey('@me/zhin-plugin-dice')).toBe('dice');
    expect(defaultInstanceKey('@zhin.js/plugin-rss')).toBe('rss');
    expect(defaultInstanceKey('my-thing')).toBe('my-thing');
  });

  it('links the plugin under plugins/ with a ./ reference, and unlinks exactly that', async () => {
    const record = await devLinkPlugin(bot, plugin, { log });
    const link = path.join(bot, 'plugins', 'glossary');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(plugin));
    expect(config()).toEqual({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox', glossary: './plugins/glossary' }, glossary: {} });
    expect(record).toMatchObject({ instanceKey: 'glossary', addedDeclaration: true, addedConfig: true });
    expect(linkedPluginKeys(bot)).toEqual(['glossary']);

    // Idempotent.
    await devLinkPlugin(bot, plugin, { log });
    expect(linkedPluginKeys(bot)).toEqual(['glossary']);

    await devUnlinkPlugin(bot, 'glossary', { log });
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(plugin)).toBe(true);
    expect(config()).toEqual({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' } });
    expect(fs.existsSync(path.join(bot, PLUGIN_LINK_STATE))).toBe(false);
  });

  it('keeps instance config the user filled in on unlink', async () => {
    await devLinkPlugin(bot, plugin, { log, instanceKey: 'terms' });
    const value = config();
    value.terms = { maxTerms: 10 };
    fs.writeFileSync(path.join(bot, 'zhin.config.json'), JSON.stringify(value, null, 2));
    await devUnlinkPlugin(bot, 'terms', { log });
    expect(config()).toEqual({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' }, terms: { maxTerms: 10 } });
  });

  it('refuses collisions instead of overwriting', async () => {
    fs.writeFileSync(path.join(bot, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { glossary: 'zhin-plugin-glossary' } }));
    await expect(devLinkPlugin(bot, plugin, { log })).rejects.toThrow('plugins.glossary');
    expect(fs.existsSync(path.join(bot, 'plugins', 'glossary'))).toBe(false);

    fs.writeFileSync(path.join(bot, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: {} }));
    fs.mkdirSync(path.join(bot, 'plugins', 'glossary'), { recursive: true });
    await expect(devLinkPlugin(bot, plugin, { log })).rejects.toThrow('已存在');
    await expect(devLinkPlugin(bot, plugin, { log, instanceKey: '../x' })).rejects.toThrow('实例名');
  });

  it('rejects non-plugins, plugins inside the bot and projects without config', async () => {
    await expect(devLinkPlugin(bot, bot, { log })).rejects.toThrow('不是 zhin 插件');
    const inside = path.join(bot, 'plugins', 'local');
    writePkg(inside, { name: 'local', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
    await expect(devLinkPlugin(bot, inside, { log })).rejects.toThrow('无需 link');
    fs.rmSync(path.join(bot, 'zhin.config.json'));
    await expect(devLinkPlugin(bot, plugin, { log })).rejects.toThrow('configVersion: 2');
    await expect(devUnlinkPlugin(bot, 'glossary', { log })).rejects.toThrow('没有通过');
  });

  it('points the plugin\'s own zhin packages at the bot\'s copies and restores them on unlink', async () => {
    const store = path.join(root, 'store');
    writePkg(path.join(bot, 'node_modules', 'zhin.js'), { name: 'zhin.js', dependencies: { '@zhin.js/command': '1' } });
    writePkg(path.join(bot, 'node_modules', 'zhin.js', 'node_modules', '@zhin.js', 'command'), { name: '@zhin.js/command' });
    // pnpm layout in the plugin: symlinks into its own store.
    writePkg(path.join(store, 'zhin.js'), { name: 'zhin.js' });
    writePkg(path.join(store, 'command'), { name: '@zhin.js/command' });
    writePkg(path.join(store, 'testing'), { name: '@zhin.js/testing' });
    fs.mkdirSync(path.join(plugin, 'node_modules', '@zhin.js'), { recursive: true });
    fs.symlinkSync('../../store/zhin.js', path.join(plugin, 'node_modules', 'zhin.js'), 'dir');
    fs.symlinkSync(path.join(store, 'testing'), path.join(plugin, 'node_modules', '@zhin.js', 'testing'), 'dir');
    // npm layout: a real directory.
    writePkg(path.join(plugin, 'node_modules', '@zhin.js', 'command'), { name: '@zhin.js/command', marker: 'plugin-copy' });

    const botZhin = fs.realpathSync(path.join(bot, 'node_modules', 'zhin.js'));
    const botCommand = fs.realpathSync(path.join(bot, 'node_modules', 'zhin.js', 'node_modules', '@zhin.js', 'command'));
    expect(findSharedZhinCopies(bot, plugin)).toEqual({
      redirectable: [{ name: '@zhin.js/command', to: botCommand }, { name: 'zhin.js', to: botZhin }],
      unresolved: [],
    });

    const record = await devLinkPlugin(bot, plugin, { log });
    expect(record.redirected?.map((entry) => entry.name)).toEqual(['@zhin.js/command', 'zhin.js']);
    expect(fs.realpathSync(path.join(plugin, 'node_modules', 'zhin.js'))).toBe(botZhin);
    expect(fs.realpathSync(path.join(plugin, 'node_modules', '@zhin.js', 'command'))).toBe(botCommand);
    expect(fs.realpathSync(path.join(plugin, 'node_modules', '@zhin.js', 'testing'))).toBe(fs.realpathSync(path.join(store, 'testing')));
    expect(findSharedZhinCopies(bot, plugin).redirectable).toEqual([]);

    await devLinkPlugin(bot, plugin, { log }); // re-link keeps the original targets
    await devUnlinkPlugin(bot, 'glossary', { log });
    expect(fs.readlinkSync(path.join(plugin, 'node_modules', 'zhin.js'))).toBe('../../store/zhin.js');
    const command = path.join(plugin, 'node_modules', '@zhin.js', 'command');
    expect(fs.lstatSync(command).isSymbolicLink()).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(command, 'package.json'), 'utf8')).marker).toBe('plugin-copy');
  });
});
