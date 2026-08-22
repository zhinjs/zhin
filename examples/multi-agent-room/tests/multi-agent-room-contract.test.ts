/**
 * multi-agent-room L4 配置契约
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('multi-agent-room 编排契约', () => {
  it('使用数据库持久化 Workroom 状态与 Catalog', () => {
    expect(configText).toMatch(/^database:/m);
    expect(configText).toMatch(/useDatabase:\s*true/m);
  });

  it('只暴露一个 Sandbox Endpoint', () => {
    const endpointMatches = configText.match(/id:\s*\w+-bot/g) ?? [];
    expect(endpointMatches).toHaveLength(1);
  });

  it('uses the Plugin Runtime topology manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
    ]);
  });

  it('README 区分普通聊天子任务与持久化 Workroom', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('Workroom Catalog');
    expect(readme).toContain('不写入 `ai.workrooms`');
    expect(readme).toContain('`spawn_task`');
    expect(readme).not.toContain('internal_room');
  });
});
