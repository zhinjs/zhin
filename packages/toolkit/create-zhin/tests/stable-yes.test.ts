import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/workspace.js';
import { applyStableYesDefaults } from '../src/stable-yes-defaults.js';
import type { InitOptions } from '../src/types.js';

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
  it('bots 为空（Sandbox 由 Console 连接时自动创建）、IM-only、无 inbox', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
    expect(config).toMatch(/endpoints:\s*\[\]/);
    expect(config).not.toMatch(/context:\s*sandbox/);
    expect(config).not.toContain('toolSearch:');
    expect(config).not.toContain('ai:');
    expect(config).not.toContain('agents:');
    expect(config).not.toContain('provider: ollama');
    expect(config).not.toContain('sdk: ollama');
    expect(config).not.toContain('model: qwen3:8b');
    expect(config).not.toContain('defaultProvider:');
    expect(config).not.toContain('inbox:');
    expect(config).not.toContain('database:');
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
  });
});
