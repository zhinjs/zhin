import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePublishTarget } from '../src/commands/pub.js';

let root: string;
const write = (dir: string, manifest: Record<string, unknown>, extra: Record<string, string> = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [file, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, file), text);
};
const plugin = { protocol: 1, type: 'plugin', entry: './plugin.js' };

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pub-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('zhin pub target', () => {
  it('publishes the current directory inside a standalone plugin', () => {
    const dir = path.join(root, 'zhin-plugin-x');
    write(dir, { name: 'zhin-plugin-x', zhin: plugin });
    expect(resolvePublishTarget(dir, undefined)).toEqual({ kind: 'directory', dir });
    expect(resolvePublishTarget(dir, '.')).toEqual({ kind: 'directory', dir });
    expect(resolvePublishTarget(root, 'zhin-plugin-x')).toEqual({ kind: 'directory', dir });
  });

  it('keeps the bot workflow: names are looked up under plugins/', () => {
    const bot = path.join(root, 'bot');
    write(bot, { name: 'bot', zhin: { ...plugin, entry: './plugin.ts' } }, { 'zhin.config.yml': 'configVersion: 2\n' });
    write(path.join(bot, 'plugins', 'weather'), { name: 'zhin-plugin-weather', zhin: plugin });
    expect(resolvePublishTarget(bot, undefined)).toEqual({ kind: 'workspace', pluginsDir: path.join(bot, 'plugins') });
    expect(resolvePublishTarget(bot, 'weather')).toEqual({ kind: 'workspace', pluginsDir: path.join(bot, 'plugins') });
    expect(resolvePublishTarget(bot, './plugins/weather')).toEqual({ kind: 'directory', dir: path.join(bot, 'plugins', 'weather') });
    // A bot project itself is never published as a plugin.
    expect(resolvePublishTarget(root, 'bot').kind).toBe('none');
    expect(resolvePublishTarget(bot, '.')).toEqual({ kind: 'workspace', pluginsDir: path.join(bot, 'plugins') });
  });

  it('explains what is missing otherwise', () => {
    write(root, { name: 'not-a-plugin' });
    const target = resolvePublishTarget(root, undefined);
    expect(target.kind).toBe('none');
    expect(target.kind === 'none' && target.message).toContain('zhin 字段');
    expect(resolvePublishTarget(root, 'nope').kind).toBe('none');
  });
});
