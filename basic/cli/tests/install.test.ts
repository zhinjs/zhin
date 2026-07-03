import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  enablePluginInProjectConfig,
  extractPluginName,
  previewEnablePlugin,
  resolvePluginNameForEnable,
  stripNpmVersion,
} from '../src/commands/install.js';

const tmpRoots: string[] = [];

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-install-'));
  tmpRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

describe('install command plugin enable helpers', () => {
  it('keeps scoped package names and strips only version suffixes', () => {
    expect(stripNpmVersion('@zhin.js/adapter-telegram@latest')).toBe('@zhin.js/adapter-telegram');
    expect(stripNpmVersion('@scope/plugin@1.2.3')).toBe('@scope/plugin');
    expect(stripNpmVersion('zhin.js-plugin-rss@^1.0.0')).toBe('zhin.js-plugin-rss');
    expect(extractPluginName('@zhin.js/adapter-telegram@latest', 'npm')).toBe('@zhin.js/adapter-telegram');
  });

  it('previews YAML config changes without writing', async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  - "example"\n');

    const preview = previewEnablePlugin(root, '@zhin.js/adapter-telegram');
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');

    expect(preview.status).toBe('enabled');
    expect(preview.message).toContain('@zhin.js/adapter-telegram');
    expect(content).not.toContain('@zhin.js/adapter-telegram');
  });

  it('writes plugin into YAML config once', async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  - "example"\n');

    const first = await enablePluginInProjectConfig(root, '@zhin.js/adapter-telegram');
    const second = await enablePluginInProjectConfig(root, '@zhin.js/adapter-telegram');
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');

    expect(first.status).toBe('enabled');
    expect(second.status).toBe('already-enabled');
    expect(content.match(/@zhin\.js\/adapter-telegram/g)).toHaveLength(1);
  });

  it('writes plugin into JSON config', async () => {
    const root = await makeTempProject();
    await fs.writeJson(path.join(root, 'zhin.config.json'), { plugins: ['example'] });

    const result = await enablePluginInProjectConfig(root, '@scope/plugin');
    const config = await fs.readJson(path.join(root, 'zhin.config.json'));

    expect(result.status).toBe('enabled');
    expect(config.plugins).toEqual(['example', '@scope/plugin']);
  });

  it('writes plugin into TOML config', async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, 'zhin.config.toml'), 'plugins = ["example"]\n');

    const result = await enablePluginInProjectConfig(root, '@scope/plugin');
    const content = await fs.readFile(path.join(root, 'zhin.config.toml'), 'utf8');

    expect(result.status).toBe('enabled');
    expect(content).toContain('"@scope/plugin"');
  });

  it('resolves local plugin installs from package.json before enabling config', async () => {
    const root = await makeTempProject();
    const pluginDir = path.join(root, 'plugins', 'my-plugin');
    await fs.ensureDir(pluginDir);
    await fs.writeJson(path.join(pluginDir, 'package.json'), { name: 'zhin.js-my-plugin' });

    expect(resolvePluginNameForEnable('./plugins/my-plugin', 'npm', root)).toBe('zhin.js-my-plugin');
    expect(resolvePluginNameForEnable('file:./plugins/my-plugin', 'npm', root)).toBe('zhin.js-my-plugin');
  });

  it('returns a manual fallback when no supported config exists', async () => {
    const root = await makeTempProject();

    const result = previewEnablePlugin(root, '@scope/plugin');

    expect(result.status).toBe('missing-config');
    expect(result.message).toContain('@scope/plugin');
  });
});
