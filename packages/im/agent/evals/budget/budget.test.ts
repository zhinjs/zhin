import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineEvalCase, runEvalCase } from '../framework/index.js';
import { measureAll, renderTable, summarize, type BaselineFile } from './measure.js';

describe('eval:budget measurement (ADR 0042 §8)', () => {
  it('is deterministic and covers the three fixed scenes', async () => {
    const first = await measureAll();
    const second = await measureAll();
    expect(first.map((scene) => scene.summary)).toEqual(second.map((scene) => scene.summary));
    expect(first.map((scene) => [scene.id, scene.summary.callCount])).toEqual([
      ['group-first-turn', 1],
      ['group-turn-6', 2],
      ['master-private-tool-turn', 3],
    ]);
    for (const scene of first) {
      expect(scene.summary.firstCallNominal).toBeGreaterThan(scene.summary.stablePrefix);
      expect(scene.summary.stablePrefix).toBeGreaterThan(0);
      expect(scene.summary.billedEquivalent).toBeLessThan(scene.summary.totalNominal);
      expect(scene.contextBudget?.total_tokens).toBeGreaterThan(0);
    }
  });

  it('prints a markdown table, with deltas against the committed baseline', async () => {
    const measures = await measureAll();
    const plain = renderTable(measures).split('\n');
    expect(plain[0]).toContain('| scene | calls | per-call nominal');
    expect(plain).toHaveLength(2 + measures.length);
    const baseline = JSON.parse(readFileSync(fileURLToPath(new URL('./baseline.json', import.meta.url)), 'utf8')) as BaselineFile;
    expect(Object.keys(baseline.scenes)).toEqual(measures.map((scene) => scene.id));
    expect(renderTable(measures, baseline)).toContain('Δ first-call');
  });

  it('summarize prices cache reads at a tenth', () => {
    expect(summarize([{ nominal: 1000, stablePrefix: 400, cachedRead: 400 }, { nominal: 1100, stablePrefix: 400, cachedRead: 1000 }]))
      .toMatchObject({ callCount: 2, firstCallNominal: 1000, totalNominal: 2100, stablePrefix: 400, cachedShareFirstCall: 0.4, billedEquivalent: 840 });
  });
});

describe('spin hint trace event (ADR 0042 §7)', () => {
  it('records spin_hint and last_iteration_nudge on the turn timeline', async () => {
    const run = await runEvalCase(defineEvalCase({
      id: 'spin-trace',
      description: 'spin trace',
      source: 'test',
      inbound: { text: 'find it', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
      agentConfig: { maxIterations: 15, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
      tools: [{ name: 'lookup', description: 'Look up.', result: 'same result' }],
      script: [
        ...[1, 2, 3, 4, 5].map((id) => ({ toolCalls: [{ name: 'lookup', args: { id } }] })),
        { text: 'done' },
      ],
      expect: {},
    }));
    const timeline = run.traces[0]!.timeline;
    expect(timeline.filter((entry) => entry.kind === 'spin_hint')).toHaveLength(1);
    expect(timeline.find((entry) => entry.kind === 'spin_hint')?.detail).toBe('lookup x3: identical_results');
    expect(timeline.filter((entry) => entry.kind === 'last_iteration_nudge').map((entry) => entry.detail)).toEqual(['5/6']);
  });
});
