import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  migrateAiLegacyConfig,
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

  it('migrates legacy AI provider fields to sdk and agents.zhin.provider', () => {
    const { ai, fixes } = migrateAiLegacyConfig({
      defaultProvider: 'ollama',
      agent: { chatModel: 'qwen3:8b' },
      providers: {
        ollama: { api: 'ollama-chat', host: 'http://127.0.0.1:11434' },
      },
    });

    expect(fixes.length).toBeGreaterThan(0);
    expect(ai.defaultProvider).toBeUndefined();
    expect((ai.providers as { ollama: { sdk?: string; api?: string } }).ollama.sdk).toBe('ollama');
    expect((ai.providers as { ollama: { sdk?: string; api?: string } }).ollama.api).toBeUndefined();
    expect((ai.agents as { zhin: { provider?: string; model?: string } }).zhin).toEqual({
      provider: 'ollama',
      model: 'qwen3:8b',
    });
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
