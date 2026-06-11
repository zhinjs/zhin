/**
 * minimal-bot Stable 路径契约（CI：pnpm check:stable）
 *
 * 入站 Sandbox + dispatch 由 plugins/adapters/sandbox/tests/integration.test.ts 覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('minimal-bot Stable 配置契约', () => {

  it('启用 AI（无 toolSearch 配置项，编排为默认）', () => {
    expect(configText).toMatch(/ai:\s*\n/);
    expect(configText).toMatch(/enabled:\s*true/);
    expect(configText).not.toMatch(/toolSearch:/);
  });

  it('bots 为空（Sandbox 由 Console 沙盒页连接时自动创建）', () => {
    expect(configText).toMatch(/endpoints:\s*\[\]/);
    expect(configText).not.toMatch(/context:\s*sandbox/);
  });

  it('插件集为 Sandbox + host-router + host-api + hello', () => {
    expect(configText).toContain('@zhin.js/adapter-sandbox');
    expect(configText).toContain('@zhin.js/host-router');
    expect(configText).toContain('@zhin.js/host-api');
    expect(configText).toContain('hello');
    expect(configText).toMatch(/agents:\s*\n\s+zhin:/);
  });

  it('README 链到 ACCEPTANCE Stable 段', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('ACCEPTANCE.md');
    expect(readme).toContain('Stable');
  });
});
