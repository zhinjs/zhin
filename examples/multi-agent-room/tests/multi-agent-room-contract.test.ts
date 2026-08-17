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
  it('不启用数据库', () => {
    expect(configText).not.toMatch(/^database:/m);
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

  it('README 说明 local Agent binding 委派', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('executor="local"');
    expect(readme).toContain('assigned_to="researcher"');
    expect(readme).not.toContain('internal_room');
  });
});
