/**
 * multi-agent-room L4 配置契约：3 个 Sandbox Bot 同群协作（Room 核心在示例内组装）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { reviewAIPlan } from '../../../tests/helpers/review-ai-plan.js';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');
const config = parse(configText);
const plan = parse(fs.readFileSync(path.join(botRoot, 'ai.plan.yml'), 'utf8'));

describe('multi-agent-room 编排契约', () => {
  it('使用数据库持久化会话', () => {
    expect(config.database.dialect).toBe('sqlite');
    expect(config.ai.sessions.useDatabase).toBe(true);
  });

  it('暴露三个 Sandbox Endpoint：coordinator / researcher / writer', () => {
    expect(config.sandbox.endpoints).toEqual([
      { id: 'coordinator-bot', owner: 'planner-user' },
      { id: 'researcher-bot', owner: 'planner-user' },
      { id: 'writer-bot', owner: 'planner-user' },
    ]);
  });

  it('独立提案中的三种角色用途与 agents 目录对应', async () => {
    const reviewed = await reviewAIPlan(plan);
    for (const agent of ['coordinator', 'researcher', 'writer']) {
      const selected = reviewed.graph.profiles[reviewed.graph.purposes.agents![agent]];
      expect(selected.model).toBe('qwen3:8b');
      expect(selected.accountId).toBe(reviewed.bindings.accounts.ollama);
      for (const file of ['agent.json', 'system.md', 'boundaries.md', 'conventions.md']) {
        expect(fs.existsSync(path.join(botRoot, 'agents', agent, file))).toBe(true);
      }
    }
    expect(config.ai).not.toHaveProperty('providers');
    expect(config.ai).not.toHaveProperty('plan');
    expect(fs.existsSync(path.join(botRoot, 'agents', 'planner'))).toBe(false);
    const boundaries = fs.readFileSync(path.join(botRoot, 'agents', 'writer', 'boundaries.md'), 'utf8');
    expect(boundaries).toContain('Room Bus');
  });

  it('uses the Plugin Runtime package contract and explicit v2 application topology', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins ?? []).toEqual([]);
    expect(config.configVersion).toBe(2);
    expect(config.plugins).toEqual({ sandbox: '@zhin.js/adapter-sandbox' });
    expect(config.disable_plugins ?? []).toEqual([]);
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
