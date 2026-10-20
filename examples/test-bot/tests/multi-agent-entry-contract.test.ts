import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFixture = path.join(botRoot, 'fixtures/multi-agent-contract.zhin.config.yml');
const configText = fs.readFileSync(configFixture, 'utf8');

describe('test-bot multi-Agent contract', () => {
  it('configures Agent bindings and the Kernel task tool', () => {
    expect(configText).toMatch(/planner:/);
    expect(configText).toMatch(/researcher:/);
    expect(configText).toMatch(/spawn_task/);
  });

  it('keeps the AI trigger prefix', () => {
    expect(configText).toMatch(/trigger:/);
    expect(configText).toContain('ai:');
  });

  it('demonstrates Agent, Skill, and Agent-Skill Tool disclosure boundaries', () => {
    for (const source of [
      'agents/evaluator/tools/calculator/index.ts',
      'skills/tool-smoke/tools/echo/index.ts',
      'skills/tool-smoke/tools/dice/index.ts',
      'agents/executor/skills/runtime-diagnostics/tools/system_info/index.ts',
      'agents/researcher/skills/weather/tools/weather/index.ts',
    ]) {
      expect(fs.existsSync(path.join(botRoot, source)), source).toBe(true);
    }
    expect(fs.existsSync(path.join(botRoot, 'tools'))).toBe(false);
  });
});
