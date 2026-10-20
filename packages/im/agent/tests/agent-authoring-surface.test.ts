import { describe, it, expect } from 'vitest';
import {
  namespaceAuthoringName,
  slotNameFromFile,
} from '../src/authoring/index.js';
import {
  discoverPluginAgentSurface,
  resolveAuthoringImportPath,
} from '../src/discovery/agent-surface.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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

describe('agent authoring entry discovery', () => {
  it('discovers public and private Hooks from named index modules', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-hook-surface-'));
    const hook = [
      "const kind = Symbol.for('zhin.authoring.kind');",
      "export default { [kind]: 'hook', event: 'turn.end', handler() {} };",
      '',
    ].join('\n');
    for (const directory of [
      'hooks/audit',
      'agents/reviewer/hooks/audit',
      'skills/research/hooks/audit',
      'agents/reviewer/skills/research/hooks/audit',
    ]) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
      fs.writeFileSync(path.join(root, directory, 'index.js'), hook);
    }
    try {
      const surface = await discoverPluginAgentSurface({
        pluginName: 'fixture',
        packageRoot: root,
        evalsDir: path.join(root, 'evals'),
      });
      expect(surface?.hooks.map((entry) => entry.slotName)).toEqual([
        'audit',
        'agent/reviewer/audit',
        'agent/reviewer/skill/research/audit',
        'skill/research/audit',
      ]);
      expect(surface?.hooks.find((entry) => entry.slotName.includes('agent/reviewer/skill')))
        .toMatchObject({ agentName: 'reviewer', skillName: 'research' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

describe('resolveAuthoringImportPath', () => {
  it('prefers the colocated JavaScript Hook output when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pkg-'));
    const source = path.join(root, 'hooks', 'audit', 'index.ts');
    const output = path.join(root, 'hooks', 'audit', 'index.js');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'export default {}');
    fs.writeFileSync(output, 'export default {}');
    expect(resolveAuthoringImportPath(root, source)).toBe(output);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
