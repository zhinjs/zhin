import { describe, it, expect } from 'vitest';
import {
  archiveCurrentRun,
  resolveRunIdRef,
  summarizeRuns,
} from '../../src/aop/pipeline/pipeline-flow.js';
import type { PipelineState } from '../../src/collaboration/types.js';

function baseState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    stage: 'planner',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['researcher'],
    todo: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe('pipeline-flow helpers', () => {
  it('resolveRunIdRef matches full id and prefix', () => {
    const state = baseState({
      runHistory: [{ runId: '11111111-2222-3333-4444-555555555555', stage: 'researcher', reviewCycles: 0, todo: [], createdAt: 1, archivedAt: 2 }],
    });
    expect(resolveRunIdRef('aaaaaaaa', state)).toBe(state.runId);
    expect(resolveRunIdRef('11111111', state)).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('archiveCurrentRun deduplicates same runId', () => {
    const state = baseState({ runHistory: [] });
    const once = archiveCurrentRun(state);
    const twice = archiveCurrentRun({ ...state, runHistory: once });
    expect(once.length).toBe(1);
    expect(twice.length).toBe(1);
  });

  it('summarizeRuns marks active run', () => {
    const state = baseState({
      runHistory: [{ runId: 'old-run', stage: 'done', reviewCycles: 0, todo: [], createdAt: 1, archivedAt: 2 }],
    });
    const runs = summarizeRuns(state);
    expect(runs[0]?.active).toBe(true);
    expect(runs[1]?.active).toBe(false);
  });
});
