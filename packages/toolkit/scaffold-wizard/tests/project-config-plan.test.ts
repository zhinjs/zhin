import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  migrateAiLegacyConfig,
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
  it('renders and applies YAML mutations for Console, Sandbox, HTTP, and plugins', async () => {
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
    expect(patch).toContain('@zhin.js/host-api');
    expect(patch).toContain('@zhin.js/adapter-sandbox');
    expect(patch).toContain('@zhin.js/adapter-telegram');
    expect(patch).toContain('https://console.zhin.dev');

    await applyProjectConfigPlan(plan);
    const content = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8');
    expect(content).toContain('@zhin.js/adapter-telegram');
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
