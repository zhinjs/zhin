import { describe, it, expect } from 'vitest';
import {
  namespaceAuthoringName,
  slotNameFromFile,
  bridgeAuthoringHook,
  defineHook,
} from '../src/authoring/index.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { AIHook, AIHookEvent } from '../src/resource-hub/types.js';

it('bridges authored hooks through the actual orchestrator hook contract without changing the handler', async () => {
  const seen: AIHookEvent[] = [];
  const definition = defineHook({ event: 'turn.end', handler: event => { seen.push(event); } });
  const hook: AIHook = bridgeAuthoringHook({ runtimeName: 'fixture_audit', definition });
  const event: AIHookEvent = { type: 'turn', action: 'end', context: {}, timestamp: new Date(0), messages: [] };
  expect(hook).toEqual({ name: 'fixture_audit', event: 'turn.end', handler: definition.handler });
  await hook.handler(event);
  expect(seen).toEqual([event]);
});

describe('namespaceAuthoringName', () => {
  it('prefixes plugin slot names', () => {
    expect(namespaceAuthoringName('lottery', 'sync')).toBe('lottery_sync');
  });

  it('allows bare workspace names', () => {
    expect(namespaceAuthoringName('workspace', 'researcher', true)).toBe('researcher');
  });
});

describe('slotNameFromFile', () => {
  it('strips extension', () => {
    expect(slotNameFromFile('/p/evals/quality.eval.ts')).toBe('quality.eval');
  });
});

describe('discoverWorkspaceAgents', () => {
  it('discovers canonical agents/<name>/ packages', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-agents-'));
    const researcher = path.join(tmp, 'agents', 'researcher');
    fs.mkdirSync(researcher, { recursive: true });
    fs.writeFileSync(path.join(researcher, 'agent.json'), JSON.stringify({
      name: 'Researcher',
      version: '1.0.0',
      description: 'Research specialist',
      trigger_rules: { file_patterns: [], keywords: ['research'] },
      entry_points: ['system.md', 'boundaries.md', 'conventions.md'],
      role: 'researcher',
    }));
    fs.writeFileSync(path.join(researcher, 'system.md'), 'You research things.\n');
    fs.writeFileSync(path.join(researcher, 'boundaries.md'), 'Stay in scope.\n');
    fs.writeFileSync(path.join(researcher, 'conventions.md'), 'Follow AGENTS.md.\n');
    try {
      const { discoverWorkspaceAgents } = await import('../src/discovery/agents.js');
      const cwd = process.cwd();
      const metas = await discoverWorkspaceAgents(tmp);
      expect(metas.some((m) => m.name === 'researcher' && m.description.includes('Research'))).toBe(true);
      expect(metas[0]?.systemPrompt).toContain('system.md');
      expect(process.cwd()).toBe(cwd);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
