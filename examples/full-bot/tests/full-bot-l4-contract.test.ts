/**
 * full-bot L4 配置契约（CI：pnpm check:l4）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');
const config = parse(configText);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
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
    // command/component 经 zhin.js 门面的 platformFeatures 继承（ADR 0053），
    // 静态声明只保留门面不覆盖的 skill/tool/page
    expect(packageJson.zhin?.features.map((feature) => feature.package)).toEqual([
      '@zhin.js/skill',
      '@zhin.js/tool',
      '@zhin.js/prompt-section',
      '@zhin.js/page',
    ]);
    expect(packageJson.dependencies?.['zhin.js']).toBeDefined();
    expect(packageJson.zhin?.plugins ?? []).toEqual([]);
    expect(config.configVersion).toBe(2);
    expect(config.plugins).toEqual({
      sandbox: '@zhin.js/adapter-sandbox',
      napcat: '@zhin.js/adapter-napcat',
      kook: '@zhin.js/adapter-kook',
    });

    for (const source of [
      'plugin.ts',
      'schema.json',
      'commands/hello/index.ts',
      'commands/card/index.ts',
      'components/status-card/index.ts',
      'skills/runtime-diagnostics/tools/runtime-status/index.ts',
      'pages/workroom/index.tsx',
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
    expect(config.ai.memory.semantic).toMatchObject({ enabled: true, autoConsolidate: false });
  });

  it('三适配器使用 v2 包映射与顶层业务配置且不再声明 legacy Host 插件', () => {
    expect(config.disable_plugins ?? []).toEqual([]);
    expect(config.sandbox.endpoints).toEqual([{ id: 'full-bot-sandbox', owner: 'local-user' }]);
    expect(config.napcat).toMatchObject({ connection: 'ws', endpoints: [{ id: 'full-bot-napcat', url: '${ONEBOT11_WS_URL}', access_token: '${ONEBOT11_ACCESS_TOKEN}' }] });
    expect(config.kook).toMatchObject({ connection: 'websocket', endpoints: [{ id: 'full-bot-kook', token: '${KOOK_TOKEN}' }] });
    expect(configText).not.toContain('@zhin.js/host-router');
    expect(configText).not.toContain('@zhin.js/host-api');
    expect(configText).not.toContain('@zhin.js/mcp');
    expect(configText).not.toContain('@zhin.js/a2a');
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
