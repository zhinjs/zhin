import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/workspace.js';
import { applyCreateDefaults } from '../src/stable-yes-defaults.js';
import { buildAdapterSetup } from '../src/flow.js';
import type { InitOptions } from '../src/types.js';
import { scaffoldDependencyRange } from '@zhin.js/scaffold-wizard';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const tmpRoots: string[] = [];

function stableYesOptions(): InitOptions {
  const options: InitOptions = {
    yes: true,
    config: 'yaml',
    httpToken: 'test-token',
  };
  applyCreateDefaults(options);
  return options;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

describe('create-zhin -y 默认值（ADR 0053：最小项目）', () => {
  it('fills only unset defaults and leaves database / adapters / AI to the Console', () => {
    const options = stableYesOptions();
    expect(options).toEqual({ yes: true, config: 'yaml', httpToken: 'test-token', template: 'default', devSkills: false });
    const flagged: InitOptions = { config: 'json', template: 'life-assistant', devSkills: true };
    applyCreateDefaults(flagged);
    expect(flagged).toEqual({ config: 'json', template: 'life-assistant', devSkills: true });
  });

  it('generates schema-valid Sandbox endpoints when --adapter sandbox is passed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-schema-'));
    tmpRoots.push(root);
    const options = stableYesOptions();
    options.adapters = await buildAdapterSetup(['sandbox'], 'zh-CN');
    await createWorkspace(root, 'schema-bot', options);
    const doc = parse(await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8'));
    const schema = await fs.readJson(fileURLToPath(new URL('../../../../plugins/adapters/sandbox/schema.json', import.meta.url)));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(doc.sandbox), JSON.stringify(validate.errors)).toBe(true);
    expect(doc.sandbox.endpoints[0]).toMatchObject({ id: 'sandbox-bot' });
    const manifest = await fs.readJson(path.join(root, 'package.json'));
    expect(manifest.packageManager).toBe('pnpm@11.27.1');
    expect(manifest).not.toHaveProperty('pnpm');
    const workspace = parse(await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    expect(workspace).toMatchObject({
      strictPeerDependencies: false,
      allowBuilds: { esbuild: true },
    });
    expect(manifest.engines.node).toBe('>=22.19.0');
  });

  it('IM-only、无适配器、无 database', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
    // 新 runtime 格式：plugins 映射为空，适配器在 Console 引导中添加
    expect(parse(config).plugins).toEqual({});
    expect(config).not.toContain('sandbox');
    expect(config).not.toContain('tokens:');
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
    expect(Object.keys(pkg.dependencies).filter((name) => name.startsWith('@zhin.js/adapter-'))).toEqual([]);
    expect(pkg.dependencies['@zhin.js/database']).toBeUndefined();
    expect(pkg.dependencies['@zhin.js/skill']).toBe(scaffoldDependencyRange('@zhin.js/skill'));
    expect(pkg.dependencies['@zhin.js/skill']).toMatch(/^\^\d+\.\d+\.\d+/u);
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
      { package: '@zhin.js/skill', api: '^1.0.0' },
    ]);
    expect(pkg.zhin.plugins).toEqual([]);
    expect(pkg.scripts.dev).toBe('zhin start --foreground --watch source config');
  });
});
