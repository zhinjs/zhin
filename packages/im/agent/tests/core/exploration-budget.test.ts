import { describe, expect, it } from 'vitest';
import { ExplorationBudget, EXPLORATION_GUIDANCE, SpinDetector } from '../../src/core/exploration-budget.js';
import { resolveModelHarness } from '../../src/config/model-harness-runtime.js';

describe('ExplorationBudget', () => {
  it('nudges after N consecutive read-only exploration calls and again at each multiple', () => {
    const budget = new ExplorationBudget(3);
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('read_file')).toBeUndefined();
    expect(budget.record('glob')).toMatch(/^\[Harness note\] 3 read-only exploration calls in a row/);
    expect(budget.record('list_dir')).toBeUndefined();
    expect(budget.record('read_file')).toBeUndefined();
    expect(budget.record('grep')).toMatch(/6 read-only exploration calls/);
  });

  it('resets when the model acts with a non-exploration tool', () => {
    const budget = new ExplorationBudget(2);
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('edit_file')).toBeUndefined();
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('read_file')).toMatch(/Harness note/);
  });

  it('is disabled by a zero or invalid budget', () => {
    for (const value of [0, -1, Number.NaN]) {
      const budget = new ExplorationBudget(value);
      for (let index = 0; index < 20; index += 1) expect(budget.record('grep')).toBeUndefined();
    }
  });

  it('guidance tells the model to plan and scope before exploring', () => {
    expect(EXPLORATION_GUIDANCE).toMatch(/scope every search/);
    expect(EXPLORATION_GUIDANCE).toMatch(/propose a plan/);
  });
});

describe('minimax model harness preset', () => {
  it('applies to direct and routed MiniMax M-series models', () => {
    for (const [provider, model] of [['minimax', 'minimax-m3'], ['openrouter', 'minimax/minimax-m3'], ['minimax', 'MiniMax-M2']]) {
      expect(resolveModelHarness(provider!, model!)).toEqual({ explorationBudget: 5, explorationGuidance: true, emptyReplyRetries: 1 });
    }
    expect(resolveModelHarness('minimax', 'abab6.5s-chat')).toEqual({});
  });

  it('keeps the configured iteration budget and lets config override the preset', () => {
    expect(resolveModelHarness('minimax', 'minimax-m3').maxIterations).toBeUndefined();
    expect(resolveModelHarness('minimax', 'minimax-m3', {
      models: { 'minimax:minimax-m3': { explorationBudget: 0, explorationGuidance: false, maxIterations: 20 } },
    })).toEqual({ maxIterations: 20, explorationBudget: 0, explorationGuidance: false, emptyReplyRetries: 1 });
  });
});

describe('SpinDetector (ADR 0042 §7)', () => {
  it('hints once after 3 same-family calls with identical results', () => {
    const spin = new SpinDetector();
    expect(spin.record('grep', { pattern: 'a' }, 'src/a.ts:1:x')).toBeUndefined();
    expect(spin.record('grep', { pattern: 'b' }, 'src/a.ts:1:x')).toBeUndefined();
    const hint = spin.record('glob', { pattern: 'c' }, 'src/a.ts:1:x');
    expect(hint).toMatchObject({ family: 'search', calls: 3, reason: 'identical_results' });
    expect(hint?.note).toMatch(/^\[Harness note\] 3 search calls in a row returned nothing new/);
    // only once per turn
    for (let index = 0; index < 5; index += 1) expect(spin.record('grep', { pattern: 'd' }, 'src/a.ts:1:x')).toBeUndefined();
  });

  it('flags searches that match nothing', () => {
    const spin = new SpinDetector();
    spin.record('grep', { pattern: 'kick' }, "No matches for 'kick'");
    spin.record('grep', { pattern: 'ban' }, "No matches for 'ban'");
    expect(spin.record('grep', { pattern: 'mute' }, "No matches for 'mute'")?.reason).toBe('no_matches');
  });

  it('flags re-reading the same file even if the digest differs', () => {
    const spin = new SpinDetector();
    spin.record('read_file', { file_path: 'a.ts', offset: 0 }, 'v1');
    spin.record('read_file', { offset: 0, file_path: 'a.ts' }, 'v2');
    expect(spin.record('read_file', { file_path: 'a.ts', offset: 0 }, 'v3')?.reason).toBe('repeated_read');
  });

  it('does not fire on varied results, other families or interleaved tools', () => {
    const spin = new SpinDetector();
    expect(spin.record('grep', { pattern: 'a' }, 'one')).toBeUndefined();
    expect(spin.record('grep', { pattern: 'b' }, 'two')).toBeUndefined();
    expect(spin.record('grep', { pattern: 'c' }, 'three')).toBeUndefined();
    expect(spin.record('read_file', { file_path: 'a.ts' }, 'same')).toBeUndefined();
    expect(spin.record('grep', { pattern: 'd' }, 'same')).toBeUndefined();
    expect(spin.record('grep', { pattern: 'e' }, 'same')).toBeUndefined();
    expect(spin.record('read_file', { file_path: 'b.ts' }, 'same')).toBeUndefined();
    expect(spin.record('read_file', { file_path: 'c.ts' }, 'same2')).toBeUndefined();
    expect(spin.record('read_file', { file_path: 'd.ts' }, 'same3')).toBeUndefined();
  });
});
