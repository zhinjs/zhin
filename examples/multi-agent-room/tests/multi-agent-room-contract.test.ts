/**
 * multi-agent-room L4 配置契约
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('multi-agent-room 协作契约', () => {
  it('启用 collaboration 且使用数据库', () => {
    expect(configText).toMatch(/collaboration:/);
    expect(configText).toMatch(/enabled:\s*true/);
    expect(configText).toMatch(/database:/);
    expect(configText).toMatch(/dialect:\s*sqlite/);
  });

  it('不预置 seed/roster，由 /collab init 在群内注册', () => {
    expect(configText).not.toMatch(/seedCells:/);
    expect(configText).not.toMatch(/^\s*roster:/m);
    expect(configText).not.toMatch(/^\s*cells:/m);
  });

  it('双 Endpoint + peer 入站策略', () => {
    expect(configText).toMatch(/peerMode:\s*mention-only/);
    const endpointMatches = configText.match(/name:\s*\w+-bot/g) ?? [];
    expect(endpointMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the Plugin Runtime topology manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
    ]);
  });

  it('README 说明 REST 与数据库 SSOT', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('collaboration/scenes');
    expect(readme).toContain('collaboration_scenes');
    expect(readme).toContain('数据库');
    expect(readme).toContain('/collab init');
  });
});
