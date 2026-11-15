import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  buildInstallArgs,
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
  vi.restoreAllMocks();
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
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {example: example}\nexample: {}\n');

    const preview = previewEnablePlugin(root, '@zhin.js/adapter-telegram');
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');

    expect(preview.status).toBe('enabled');
    expect(preview.message).toContain('@zhin.js/adapter-telegram');
    expect(content).not.toContain('@zhin.js/adapter-telegram');
  });

  it('writes plugin into YAML config once', async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {example: example}\nexample: {}\n');

    const first = await enablePluginInProjectConfig(root, '@zhin.js/adapter-telegram');
    const second = await enablePluginInProjectConfig(root, '@zhin.js/adapter-telegram');
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');

    expect(first.status).toBe('enabled');
    expect(second.status).toBe('already-enabled');
    expect((await import('yaml')).parse(content).plugins).toEqual({ example: 'example', telegram: '@zhin.js/adapter-telegram' });
    expect(content.match(/@zhin\.js\/adapter-telegram/gu)).toHaveLength(1);
  });

  it('writes plugin into JSON config', async () => {
    const root = await makeTempProject();
    await fs.writeJson(path.join(root, 'zhin.config.json'), {configVersion: 2, plugins: {example: 'example'}, example: {}});

    const result = await enablePluginInProjectConfig(root, '@scope/reminder');
    const config = await fs.readJson(path.join(root, 'zhin.config.json'));

    expect(result.status).toBe('enabled');
    expect(config.plugins).toEqual({example: 'example', reminder: '@scope/reminder'});
    expect(config.reminder).toBeUndefined();
  });

  it('refuses to enable plugins in a legacy list-form config', async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  - "example"\n');

    const result = previewEnablePlugin(root, '@scope/reminder');

    expect(result.status).toBe('unsupported-config');
    expect(result.message).toContain('zhin migrate');
    expect(await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8'))
      .toBe('plugins:\n  - "example"\n');
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

    const result = previewEnablePlugin(root, '@scope/reminder');

    expect(result.status).toBe('missing-config');
    expect(result.message).toContain('@scope/reminder');
  });
});

describe('install dry-run preview and exact pins (#1250)', () => {
  it('previews the config change as a diff of the changed lines, keeping comments', async () => {
    const root = await makeTempProject();
    const settings = Array.from({ length: 30 }, (_, index) => `  # 第 ${index} 项\n  key${index}: ${index}`).join('\n');
    await fs.writeFile(path.join(root, 'zhin.config.yml'), `# 顶部注释\nconfigVersion: 2\nplugins:\n  # 示例\n  example: example\nexample:\n${settings}\n`);

    const preview = previewEnablePlugin(root, '@zhin.js/plugin-nettools');

    expect(preview.patch).toMatch(/^--- a\/zhin\.config\.yml\n\+\+\+ b\/zhin\.config\.yml\n@@ /u);
    expect(preview.patch).toContain('   # 示例\n');
    expect(preview.patch).toMatch(/\n\+ {2}nettools: .*@zhin\.js\/plugin-nettools/u);
    expect(preview.patch).not.toContain('key29');
    expect(preview.patch!.split('\n').filter(line => /^[-+](?![-+]{2})/u.test(line))).toHaveLength(1);
  });

  async function projectWith(dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) {
    const root = await makeTempProject();
    await fs.writeJson(path.join(root, 'package.json'), { name: 'bot', dependencies, devDependencies });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    return root;
  }

  it('adds --save-exact when every zhin dependency is pinned to an exact version', async () => {
    await projectWith({ 'zhin.js': '1.5.0', '@zhin.js/adapter-sandbox': '1.2.3', lodash: '^4.17.0' }, { '@zhin.js/cli': '1.6.0' });
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', {})).toEqual(['add', '--save-exact', '@zhin.js/plugin-nettools']);
    expect(buildInstallArgs('@zhin.js/plugin-nettools@latest', 'npm', {})).toEqual(['add', '--save-exact', '@zhin.js/plugin-nettools@latest']);
  });

  it('keeps the default range when any zhin dependency uses ^ or ~', async () => {
    await projectWith({ 'zhin.js': '1.5.0', '@zhin.js/adapter-sandbox': '^1.2.3' });
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', {})).toEqual(['add', '@zhin.js/plugin-nettools']);
    await projectWith({ 'zhin.js': '~1.5.0' });
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', {})).toEqual(['add', '@zhin.js/plugin-nettools']);
  });

  it('ignores non-registry specs and needs at least one registry zhin dependency', async () => {
    await projectWith({ 'zhin.js': 'workspace:*', '@zhin.js/adapter-sandbox': '1.2.3' });
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', {})).toContain('--save-exact');
    await projectWith({ 'zhin.js': 'workspace:*', lodash: '4.17.21' });
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', {})).not.toContain('--save-exact');
    await projectWith({ 'zhin.js': '1.5.0' });
    expect(buildInstallArgs('user/repo', 'github', {})).not.toContain('--save-exact');
    expect(buildInstallArgs('@zhin.js/plugin-nettools', 'npm', { global: true })).not.toContain('--save-exact');
  });
});
