/**
 * multi-agent-room L4 配置契约：3 个 Sandbox Bot 同群协作（Room 核心在示例内组装）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('multi-agent-room 编排契约', () => {
  it('使用数据库持久化会话', () => {
    expect(configText).toMatch(/^database:/m);
    expect(configText).toMatch(/useDatabase:\s*true/m);
  });

  it('暴露三个 Sandbox Endpoint：coordinator / researcher / writer', () => {
    const endpointMatches = configText.match(/id:\s*([\w-]+-bot)/g) ?? [];
    expect(endpointMatches.map((line) => line.replace(/id:\s*/, ''))).toEqual([
      'coordinator-bot',
      'researcher-bot',
      'writer-bot',
    ]);
    expect(configText.match(/owner:\s*planner-user/g) ?? []).toHaveLength(3);
  });

  it('ai.agents 与 agents 目录对应三个角色', () => {
    for (const agent of ['coordinator', 'researcher', 'writer']) {
      expect(configText).toMatch(new RegExp(`^    ${agent}:`, 'm'));
      for (const file of ['agent.json', 'system.md', 'boundaries.md', 'conventions.md']) {
        expect(fs.existsSync(path.join(botRoot, 'agents', agent, file))).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(botRoot, 'agents', 'planner'))).toBe(false);
    const boundaries = fs.readFileSync(path.join(botRoot, 'agents', 'writer', 'boundaries.md'), 'utf8');
    expect(boundaries).toContain('Room Bus');
  });

  it('uses the Plugin Runtime topology manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
    ]);
    expect(manifest.dependencies['@zhin.js/workroom']).toBe('workspace:*');
  });

  it('README 说明三 Bot 同群协作与当前接线状态', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('3 个 Bot');
    expect(readme).toContain('同一个群');
    expect(readme).toContain('示例内组装，默认运行时未接入');
    expect(readme).toContain('Room Bus');
    expect(readme).not.toContain('不需要多个 Bot 账号');
  });
});
