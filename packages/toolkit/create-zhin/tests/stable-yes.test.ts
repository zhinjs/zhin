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
  it('生成单 sandbox bot、启用 AI、toolSearch 关闭、无 inbox', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-stable-'));
    tmpRoots.push(root);
    const projectPath = path.join(root, 'stable-bot');

    await createWorkspace(projectPath, 'stable-bot', stableYesOptions());

    const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
    expect(config).toContain('context: sandbox');
    expect(config).toContain('name: sandbox-bot');
    expect(config).toContain('toolSearch: false');
    expect(config).toContain('defaultProvider: ollama');
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
});
