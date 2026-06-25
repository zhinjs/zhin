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

  it('默认关闭 AI（IM-only 安装体积；启用见 full-bot）', () => {
    expect(configText).toMatch(/ai:\s*\n/);
    expect(configText).toMatch(/enabled:\s*false/);
    expect(configText).not.toMatch(/toolSearch:/);
    expect(configText).not.toMatch(/agents:\s*\n\s+zhin:/);
  });

  it('bots 为空（Sandbox 由 Console 沙盒页连接时自动创建）', () => {
    expect(configText).toMatch(/endpoints:\s*\[\]/);
    expect(configText).not.toMatch(/context:\s*sandbox/);
  });

  it('插件集为 Sandbox + host-router + host-api + hello（无 agent 栈）', () => {
    expect(configText).toContain('@zhin.js/adapter-sandbox');
    expect(configText).toContain('@zhin.js/host-router');
    expect(configText).toContain('@zhin.js/host-api');
    expect(configText).toContain('hello');
    expect(configText).not.toMatch(/agents:\s*\n\s+zhin:/);
  });

  it('README 链到 ACCEPTANCE Stable 段', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('ACCEPTANCE.md');
    expect(readme).toContain('Stable');
  });

  it('hello 插件含 card 与 setup --ai 首跑引导', () => {
    const hello = fs.readFileSync(path.join(botRoot, 'src', 'plugins', 'hello.ts'), 'utf8');
    expect(hello).toContain('setup --ai');
    expect(hello).toContain('card');
  });
});
