/**
 * full-bot L4 配置契约（CI：pnpm check:l4）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
  zhin?: {
    entry: string;
    features: Array<{ package: string }>;
    plugins: Array<{ package: string; instanceKey: string }>;
  };
};

describe('full-bot L4 配置契约', () => {
  it('由 Plugin Runtime 与约定式能力目录启动', () => {
    expect(packageJson.scripts.dev).toBe('zhin runtime start');
    expect(packageJson.scripts.start).toContain('zhin runtime start');
    expect(packageJson.zhin?.entry).toBe('./plugin.ts');
    expect(packageJson.zhin?.features.map((feature) => feature.package)).toEqual([
      '@zhin.js/command',
      '@zhin.js/component',
      '@zhin.js/skill',
      '@zhin.js/tool',
      '@zhin.js/page',
    ]);
    expect(packageJson.zhin?.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
      { package: '@zhin.js/adapter-napcat', instanceKey: 'napcat' },
      { package: '@zhin.js/adapter-kook', instanceKey: 'kook' },
    ]);

    for (const source of [
      'plugin.ts',
      'schema.json',
      'commands/hello.ts',
      'commands/card.ts',
      'components/status-card.ts',
      'tools/runtime-status.ts',
      'pages/orchestration.tsx',
    ]) {
      expect(fs.existsSync(path.join(botRoot, source)), source).toBe(true);
    }
    expect(fs.existsSync(path.join(botRoot, 'src', 'plugins'))).toBe(false);
  });

  it('ADR 0024 Pipeline 取代 Missions 配置开关', () => {
    expect(configText).not.toMatch(/hardMode:/);
    expect(configText).not.toMatch(/autoAdvance:/);
    expect(configText).not.toMatch(/MISSIONS_TEMPLATE/);
  });

  it('启用语义记忆 semantic', () => {
    expect(configText).toMatch(/memory:\s*\n/);
    expect(configText).toMatch(/semantic:\s*\n/);
    expect(configText).toMatch(/enabled:\s*true/);
    expect(configText).toMatch(/autoConsolidate:\s*false/);
  });

  it('三适配器使用层级 Plugin 配置且不再声明 legacy Host 插件', () => {
    expect(configText).toMatch(/plugins:\s*\n\s+sandbox:/u);
    expect(configText).toMatch(/\n\s+napcat:/u);
    expect(configText).toMatch(/\n\s+kook:/u);
    expect(configText).not.toContain('@zhin.js/host-router');
    expect(configText).not.toContain('@zhin.js/host-api');
    expect(configText).not.toContain('@zhin.js/mcp');
    expect(configText).not.toContain('@zhin.js/a2a');
  });

  it('loopback remoteAgents 指向本机 A2A Agent Card', () => {
    expect(configText).toMatch(/remoteAgents:/);
    expect(configText).toMatch(/id:\s*local/);
    expect(configText).toMatch(/cardUrl:/);
    expect(configText).toMatch(/\/a2a\/zhin\/.well-known\/agent-card\.json/);
  });

  it('MEMORY 纲领与 memory-consolidate skill 存在', () => {
    const memory = fs.readFileSync(
      path.join(botRoot, 'data/memory/global/MEMORY.md'),
      'utf8',
    );
    expect(memory).toContain('项目总监');
    const skill = fs.readFileSync(
      path.join(botRoot, 'skills/memory-consolidate/SKILL.md'),
      'utf8',
    );
    expect(skill).toContain('memory_upsert');
    expect(skill).toContain('memory_search');
  });

  it('README 链到 ACCEPTANCE L4 段', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('ACCEPTANCE.md');
    expect(readme).toContain('L4');
  });
});
