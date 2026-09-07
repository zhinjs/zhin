import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/workspace.js';
import { applyStableYesDefaults } from '../src/stable-yes-defaults.js';
import type { InitOptions } from '../src/types.js';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const tmpRoots: string[] = [];

function stableYesOptions(): InitOptions {
  const options: InitOptions = {
    yes: true,
    config: 'yaml',
    runtime: 'node',
    httpToken: 'test-token',
    installGlobalCli: false,
  };
  applyStableYesDefaults(options);
  return options;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

describe('create-zhin -y Stable 默认值', () => {
  it.each([true, false])('generates schema-valid Sandbox endpoints (explicit defaults: %s)', async (explicit) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-schema-'));
    tmpRoots.push(root);
    const options = stableYesOptions();
    if (!explicit) options.adapters = undefined;
    await createWorkspace(root, 'schema-bot', options);
    const doc = parse(await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8'));
    const schema = await fs.readJson(fileURLToPath(new URL('../../../../plugins/adapters/sandbox/schema.json', import.meta.url)));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(doc.plugins.sandbox), JSON.stringify(validate.errors)).toBe(true);
    expect(doc.plugins.sandbox.endpoints[0]).toMatchObject({ id: 'sandbox-bot' });
    const manifest = await fs.readJson(path.join(root, 'package.json'));
    expect(manifest.packageManager).toBe('pnpm@9.0.2');
    expect(manifest.engines.node).toBe('>=22.12.0');
  });

  it('Sandbox 实例 + IM-only、无 database', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
    // 新 runtime 格式：plugins.<instanceKey> 映射，sandbox 带默认 Endpoint
    expect(config).toContain('plugins:');
    expect(config).toContain('sandbox:');
    expect(config).toContain('context: sandbox');
    expect(config).not.toMatch(/^endpoints:/m);
    expect(config).not.toContain('toolSearch:');
    expect(config).not.toContain('ai:');
    expect(config).not.toContain('agents:');
    expect(config).not.toContain('provider: ollama');
    expect(config).not.toContain('sdk: ollama');
    expect(config).not.toContain('model: qwen3:8b');
    expect(config).not.toContain('defaultProvider:');
    expect(config).not.toContain('inbox:');
    expect(config).not.toContain('database:');
    expect(config).toContain(`port: ${8068}`);
  });

  it('不安装 devSkills 模板', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    await expect(fs.pathExists(path.join(projectPath, 'skills', 'plugin-init', 'SKILL.md'))).resolves.toBe(
      false,
    );
  });

  it('不预装 AI 栈依赖', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const pkg = await fs.readJson(path.join(projectPath, 'package.json'));
    expect(pkg.dependencies['@zhin.js/agent']).toBeUndefined();
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(pkg.dependencies.ai).toBeUndefined();
    expect(pkg.dependencies.zod).toBeUndefined();
    expect(pkg.dependencies.vite).toBeUndefined();
    expect(pkg.dependencies['@zhin.js/client']).toBeUndefined();
    expect(pkg.dependencies['@zhin.js/pagemanager']).toBeUndefined();
    expect(pkg.dependencies.esbuild).toBeUndefined();
    expect(pkg.dependencies.react).toBeUndefined();
    expect(pkg.zhin.features).toEqual([
      { package: '@zhin.js/page', api: '^1.0.0' },
      { package: '@zhin.js/layout', api: '^1.0.0' },
    ]);
    expect(pkg.zhin.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
    ]);
    expect(pkg.scripts.dev).toBe('zhin runtime start');
  });
});
