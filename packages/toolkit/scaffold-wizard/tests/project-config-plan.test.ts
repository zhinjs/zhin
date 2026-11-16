import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  packageToInstanceKey,
  renderProjectConfigPatch,
} from '../src/project-config-plan.js';

const tmpRoots: string[] = [];

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-project-plan-'));
  tmpRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

describe('ProjectConfigPlan', () => {
  it('marks legacy list-form configs unsupported and leaves them untouched', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  - "example"\n');

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({
      loaded,
      ensureConsole: true,
      ensureSandbox: true,
      ensureHttp: true,
      enablePlugins: ['@zhin.js/adapter-telegram'],
    });
    expect(loaded.status).toBe('unsupported');
    expect(loaded.message).toContain('zhin migrate');
    expect(plan.changed).toBe(false);
    expect(plan.writable).toBe(false);
    await expect(applyProjectConfigPlan(plan)).resolves.toBe(false);
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');
    expect(content).toBe('plugins:\n  - "example"\n');
  });

  it('does not write host plugins into new runtime plugins map configs', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), "configVersion: 2\nplugins:\n  sandbox: '@zhin.js/adapter-sandbox'\nsandbox: {}\n");

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({
      loaded,
      ensureConsole: true,
      ensureHttp: true,
    });
    const patch = renderProjectConfigPatch(plan);

    // Console Host 由 CLI 装配，不再向配置写入 host 插件
    expect(patch).not.toContain('@zhin.js/host-api');
    expect(patch).toContain('https://console.zhin.dev');
  });

  it('adds instanceKey entries to new runtime plugins map configs', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), "configVersion: 2\nplugins:\n  sandbox: '@zhin.js/adapter-sandbox'\nsandbox: {}\n");

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({
      loaded,
      ensureSandbox: true,
      enablePlugins: ['@zhin.js/adapter-telegram'],
    });

    expect(plan.changed).toBe(true);
    const plugins = plan.after.plugins as Record<string, unknown>;
    expect(plugins.sandbox).toBe('@zhin.js/adapter-sandbox');
    expect(plugins.telegram).toBe('@zhin.js/adapter-telegram');

    await applyProjectConfigPlan(plan);
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');
    expect(content).toContain('telegram:');
  });

  it('loads the canonical config.yml Root filename', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'config.yml'), "configVersion: 2\nplugins:\n  example: '@scope/example'\nexample: {}\n");

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({ loaded, enablePlugins: ['@scope/plugin-sample'] });
    expect(loaded.status).toBe('loaded');
    expect(plan.changed).toBe(true);
    await expect(applyProjectConfigPlan(plan)).resolves.toBe(true);
    expect(await fs.readFile(path.join(root, 'config.yml'), 'utf8')).toContain('sample:');
  });

  it('rejects projects with multiple Root configuration files', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'config.json'), '{}\n');
    await fs.writeFile(path.join(root, 'zhin.config.yml'), '{}\n');
    expect(() => loadProjectConfig(root)).toThrow(/Multiple Root config files found/);
  });

  it('preserves legacy AI configuration while repairing Console prerequisites', () => {
    const ai = { defaultProvider: 'ollama', agent: { chatModel: 'qwen3:8b' }, providers: { ollama: { api: 'ollama-chat', host: 'http://127.0.0.1:11434' } } };
    const plan = createProjectConfigPlan({ config: { ai }, ensureConsole: true });
    expect(plan.after.ai).toEqual(ai);
    expect(plan.mutations.some(change => change.includes('ai.'))).toBe(false);
    expect(plan.after.http).toBeDefined();
  });
});

describe('packageToInstanceKey', () => {
  it('derives instanceKey from package names', () => {
    expect(packageToInstanceKey('@zhin.js/adapter-telegram')).toBe('telegram');
    expect(packageToInstanceKey('@zhin.js/plugin-game-hub')).toBe('game-hub');
    expect(packageToInstanceKey('@zhin.js/service-activity-feedback')).toBe('activity-feedback');
    expect(packageToInstanceKey('example')).toBe('example');
  });
});


it('rejects duplicate JSON declaration keys before a config plan can be applied', async () => {
  const root = await makeProject();
  await fs.writeFile(path.join(root, 'config.json'), '{"configVersion":2,"plugins":{"a":"one","a":"two"}}');
  expect(() => loadProjectConfig(root)).toThrow(/unique|Duplicate/);
});

it.each(['# concurrent comment\n', 'configVersion: 2\nplugins:\n  "2": two\n  "10": ten\n'])('rejects source drift after preview even when business values are unchanged', async source => {
  const root = await makeProject();
  const file = path.join(root, 'zhin.config.yml');
  const original = 'configVersion: 2\nplugins:\n  "10": ten\n  "2": two\n';
  await fs.writeFile(file, original);
  const plan = createProjectConfigPlan({ loaded: loadProjectConfig(root), ensureHttp: true });
  const changed = source.startsWith('#') ? source + original : source;
  await fs.writeFile(file, changed);
  await expect(applyProjectConfigPlan(plan)).rejects.toThrow('预览后发生变更');
  expect(await fs.readFile(file, 'utf8')).toBe(changed);
});

describe('renderProjectConfigPatch preview (#1250 install-dry-run-dumps-whole-config)', () => {
  const filler = Array.from({ length: 40 }, (_, index) => `  # 说明 ${index}\n  setting${index}: ${index}`).join('\n');
  const source = [
    '# 项目配置（注释必须保留）',
    'configVersion: 2',
    'plugins:',
    '  # 沙箱适配器',
    "  sandbox: '@zhin.js/adapter-sandbox'",
    'sandbox:',
    filler,
    '',
  ].join('\n');

  it('shows only the changed lines with a few lines of context, as the real write would produce them', async () => {
    const root = await makeProject();
    const file = path.join(root, 'zhin.config.yml');
    await fs.writeFile(file, source);
    const plan = createProjectConfigPlan({ loaded: loadProjectConfig(root), enablePlugins: ['@zhin.js/plugin-nettools'] });

    const patch = renderProjectConfigPatch(plan);
    const lines = patch.trimEnd().split('\n');
    expect(lines[0]).toBe('--- a/zhin.config.yml');
    expect(lines[1]).toBe('+++ b/zhin.config.yml');
    expect(lines.filter(line => line.startsWith('@@'))).toHaveLength(1);
    const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++'));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^\+ {2}nettools: .*@zhin\.js\/plugin-nettools/);
    expect(lines.filter(line => line.startsWith('-') && !line.startsWith('---'))).toEqual([]);
    // The rest of the 80+ line file is not reprinted; the context lines keep their comments.
    expect(lines.length).toBeLessThan(15);
    expect(patch).toContain('\n   # 沙箱适配器\n');
    expect(patch).toContain('\n plugins:\n');
    // Lines further than the context away (the file's top comment, the 40 settings) are left out.
    expect(patch).not.toContain('项目配置');
    expect(patch).not.toContain('setting39');

    // The preview is exactly what applying the plan writes: the same single added line.
    await applyProjectConfigPlan(plan);
    const written = await fs.readFile(file, 'utf8');
    expect(written).toContain('# 说明 39');
    expect(written).toContain('# 沙箱适配器');
    const original = new Set(source.split('\n'));
    expect(written.split('\n').filter(line => !original.has(line))).toEqual([added[0]!.slice(1)]);
  });

  it('reports separate hunks for changes far apart', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), source);
    const plan = createProjectConfigPlan({
      loaded: loadProjectConfig(root), enablePlugins: ['@zhin.js/plugin-nettools'], ensureHttp: true,
    });

    const patch = renderProjectConfigPatch(plan);
    expect(patch.split('\n').filter(line => line.startsWith('@@'))).toHaveLength(2);
    expect(patch).toContain('\n+http:');
    expect(patch).toContain('https://console.zhin.dev');
    expect(patch).not.toContain('setting20');
  });

  it('keeps JSON previews to the changed keys too', async () => {
    const root = await makeProject();
    const keys = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key${index}`, index]));
    const json = `${JSON.stringify({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' }, sandbox: keys }, null, 2)}\n`;
    await fs.writeFile(path.join(root, 'zhin.config.json'), json);
    const plan = createProjectConfigPlan({ loaded: loadProjectConfig(root), enablePlugins: ['@zhin.js/plugin-nettools'] });

    const patch = renderProjectConfigPatch(plan);
    expect(patch).toContain('--- a/zhin.config.json');
    expect(patch).toMatch(/\n\+ {4}"nettools": "@zhin\.js\/plugin-nettools"/);
    expect(patch).not.toContain('key29');
  });

  it('keeps a CRLF file CRLF: the preview shows the added line only, no line-ending change', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), source.replaceAll('\n', '\r\n'));
    const plan = createProjectConfigPlan({ loaded: loadProjectConfig(root), enablePlugins: ['@zhin.js/plugin-nettools'] });
    const patch = renderProjectConfigPatch(plan);
    expect(patch).not.toContain('line endings');
    expect(patch.split('\n').filter(line => /^[-+](?![-+]{2})/u.test(line))).toHaveLength(1);
  });

  it('says nothing changes when the plugin is already declared', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), source);
    const plan = createProjectConfigPlan({ loaded: loadProjectConfig(root), enablePlugins: ['@zhin.js/adapter-sandbox'] });
    expect(renderProjectConfigPatch(plan)).toBe('配置无需改动。');
  });
});
