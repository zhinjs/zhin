/**
 * test-bot 协作入口契约（阶段 4；无真实 Endpoint）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createInboundTurnPipeline } from '@zhin.js/agent';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('test-bot 协作入口契约', () => {
  it('createInboundTurnPipeline 可从 @zhin.js/agent 解析', () => {
    expect(typeof createInboundTurnPipeline).toBe('function');
  });

  it('多 Agent 路由与 peerMode 已配置', () => {
    expect(configText).toMatch(/peerMode:\s*mention-only/);
    expect(configText).toMatch(/planner:/);
    expect(configText).toMatch(/researcher:/);
    expect(configText).toMatch(/spawn_task/);
  });

  it('AI trigger 前缀存在', () => {
    expect(configText).toMatch(/trigger:/);
    expect(configText).toContain('ai:');
  });
});
