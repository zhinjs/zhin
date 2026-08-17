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
});
