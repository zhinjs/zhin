import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MCP_SDK_VERSION } from '@zhin.js/scaffold-wizard';
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
  it('bots 为空（Sandbox 由 Console 连接时自动创建）、启用 AI、无 inbox', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
    expect(config).toMatch(/endpoints:\s*\[\]/);
    expect(config).not.toMatch(/context:\s*sandbox/);
    expect(config).not.toContain('toolSearch:');
    expect(config).toContain('agents:');
    expect(config).toContain('provider: ollama');
    expect(config).toContain('sdk: ollama');
    expect(config).toContain('model: qwen3:8b');
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

  it('AI 启用时预装 MCP SDK', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const pkg = await fs.readJson(path.join(projectPath, 'package.json'));
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBe(MCP_SDK_VERSION);
  });
});
