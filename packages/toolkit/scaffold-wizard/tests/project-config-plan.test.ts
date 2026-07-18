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
  it('keeps legacy list-form configs list-form and ensures http for Console', async () => {
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
    const patch = renderProjectConfigPatch(plan);

    expect(plan.changed).toBe(true);
    // legacy 数组形态保持旧行为：host 插件与 sandbox 追加到列表
    expect(patch).toContain('@zhin.js/host-api');
    expect(patch).toContain('@zhin.js/adapter-sandbox');
    expect(patch).toContain('@zhin.js/adapter-telegram');
    expect(patch).toContain('https://console.zhin.dev');

    await applyProjectConfigPlan(plan);
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');
    expect(content).toContain('@zhin.js/adapter-telegram');
  });

  it('does not write host plugins into new runtime plugins map configs', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  sandbox: {}\n');

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
    await fs.writeFile(path.join(root, 'zhin.config.yml'), 'plugins:\n  sandbox: {}\n');

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({
      loaded,
      ensureSandbox: true,
      enablePlugins: ['@zhin.js/adapter-telegram'],
    });

    expect(plan.changed).toBe(true);
    const plugins = plan.after.plugins as Record<string, unknown>;
    expect(plugins.sandbox).toEqual({});
    expect(plugins.telegram).toEqual({});

    await applyProjectConfigPlan(plan);
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');
    expect(content).toContain('telegram:');
  });

  it('writes TOML configs through the same plan', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.toml'), 'plugins = ["example"]\n');

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({ loaded, enablePlugins: ['@scope/plugin'] });
    await applyProjectConfigPlan(plan);
    const content = await fs.readFile(path.join(root, 'zhin.config.toml'), 'utf8');

    expect(content).toContain('"@scope/plugin"');
  });

  it('returns a copyable patch for readonly TypeScript configs', async () => {
    const root = await makeProject();
    await fs.writeFile(path.join(root, 'zhin.config.ts'), 'export default {}\n');

    const loaded = loadProjectConfig(root);
    const plan = createProjectConfigPlan({
      loaded,
      config: { plugins: ['example'] },
      enablePlugins: ['@scope/plugin'],
    });

    expect(loaded.status).toBe('unsupported');
    expect(plan.writable).toBe(false);
    expect(renderProjectConfigPatch(plan)).toContain('@scope/plugin');
    await expect(applyProjectConfigPlan(plan)).resolves.toBe(false);
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
