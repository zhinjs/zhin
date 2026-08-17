/**
 * test-bot 协作配置契约（阶段 4；无真实 Endpoint）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFixture = path.join(botRoot, 'fixtures/collaboration-contract.zhin.config.yml');
const configText = fs.readFileSync(configFixture, 'utf8');

describe('test-bot 协作配置契约', () => {
  it('多 Agent bindings 与 spawn_task 已配置', () => {
    expect(configText).toMatch(/planner:/);
    expect(configText).toMatch(/researcher:/);
    expect(configText).toMatch(/spawn_task/);
  });

  it('AI trigger 前缀存在', () => {
    expect(configText).toMatch(/trigger:/);
    expect(configText).toContain('ai:');
  });
});
