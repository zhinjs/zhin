import { describe, it, expect, beforeEach } from 'vitest';
import {
  allowedNextStages,
  isTransitionAllowed,
  isRejectTransition,
} from '../../src/aop/pipeline/pipeline-transitions.js';
import { PipelineService } from '../../src/aop/pipeline/pipeline-service.js';
import { MemoryCollaborationArtifactRepository } from '../../src/collaboration/collaboration-artifact-repository.js';
import type { CollaborationCell, PipelineState } from '../../src/collaboration/types.js';

describe('pipeline transitions', () => {
  it('full path is planner→researcher→evaluator→executor→reviewer', () => {
    expect(allowedNextStages('planner', 'full')).toContain('researcher');
    expect(allowedNextStages('researcher', 'full')).toEqual(['evaluator']);
    expect(allowedNextStages('evaluator', 'full')).toEqual(['executor']);
    expect(allowedNextStages('executor', 'full')).toEqual(['reviewer']);
    expect(allowedNextStages('reviewer', 'full')).toContain('planner');
  });

  it('compact allows planner shortcut to executor', () => {
    expect(isTransitionAllowed('planner', 'executor', 'compact')).toBe(true);
    expect(isTransitionAllowed('planner', 'executor', 'full')).toBe(false);
  });

  it('reviewer reject is detected', () => {
    expect(isRejectTransition('reviewer', 'evaluator')).toBe(true);
    expect(isRejectTransition('planner', 'researcher')).toBe(false);
  });
});

describe('PipelineService', () => {
  let cell: CollaborationCell;
  let svc: PipelineService;

  beforeEach(() => {
    cell = {
      id: 'cellA',
      adapter: 'sandbox',
      sceneId: 'g1',
      members: [
        { endpointId: 'p', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: 'r', primary: 'researcher', pipelineRole: 'researcher' },
        { endpointId: 'e', primary: 'evaluator', pipelineRole: 'evaluator' },
        { endpointId: 'x', primary: 'executor', pipelineRole: 'executor' },
        { endpointId: 'v', primary: 'reviewer', pipelineRole: 'reviewer' },
      ],
    };
    svc = new PipelineService({
      cells: {
        getCell: (id) => (id === cell.id ? cell : undefined),
        setPipelineState: async (id, state: PipelineState) => {
          if (id === cell.id) cell = { ...cell, pipelineState: state };
        },
      },
      artifacts: new MemoryCollaborationArtifactRepository(),
    });
  });

  it('initializes planner stage', async () => {
    const state = await svc.initState(cell, { userGoal: 'ship it' });
    expect(state.stage).toBe('planner');
    expect(state.userGoal).toBe('ship it');
    expect(state.reviewCycles).toBe(0);
  });

  it('rejects illegal transition', async () => {
    await svc.initState(cell, {});
    const res = await svc.advance('cellA', 'reviewer');
    expect(res.ok).toBe(false);
  });

  it('circuit-breaks after maxReviewCycles', async () => {
    await svc.initState(cell, { maxReviewCycles: 2 });
    // drive to reviewer
    await svc.advance('cellA', 'researcher');
    await svc.advance('cellA', 'evaluator');
    await svc.advance('cellA', 'executor');
    await svc.advance('cellA', 'reviewer');
    // first reject (cycle 1)
    let res = await svc.advance('cellA', 'evaluator');
    expect(res.state?.reviewCycles).toBe(1);
    // back to reviewer
    await svc.advance('cellA', 'executor');
    await svc.advance('cellA', 'reviewer');
    // second reject hits max → failed
    res = await svc.advance('cellA', 'evaluator');
    expect(res.state?.stage).toBe('failed');
  });

  it('reviewer slice excludes evaluator blueprint', async () => {
    const state = await svc.initState(cell, { userGoal: 'g' });
    await svc.submitArtifact({ cellId: 'cellA', runId: state.runId, stage: 'researcher', kind: 'citations', payload: { src: 'a' } });
    await svc.submitArtifact({ cellId: 'cellA', runId: state.runId, stage: 'evaluator', kind: 'blueprint', payload: { secret: 'cot' } });
    await svc.submitArtifact({ cellId: 'cellA', runId: state.runId, stage: 'executor', kind: 'deliverable', payload: { out: 'final' } });
    const slice = await svc.reviewerContextSlice('cellA', state.runId);
    expect(slice.deliverable).toEqual({ out: 'final' });
    expect(JSON.stringify(slice)).not.toContain('cot');
  });

  it('resetRun issues new runId and clears delegations', async () => {
    const first = await svc.initState(cell, { userGoal: 'old goal' });
    await svc.submitArtifact({
      cellId: 'cellA',
      runId: first.runId,
      stage: 'researcher',
      kind: 'report',
      payload: { summary: 'prior run' },
    });
    await svc.advance('cellA', 'researcher');
    cell = {
      ...cell,
      pipelineState: {
        ...(cell.pipelineState ?? first),
        stage: 'researcher',
        activeDelegations: [{
          targetEndpointId: 'r',
          targetRole: 'researcher',
          runId: first.runId,
          mode: 'pipeline',
          requireArtifact: true,
          artifactKinds: ['report'],
          delegateText: 'research',
          updatedAt: Date.now(),
        }],
        todo: [{ id: '1', text: 'x', done: false }],
      },
    };
    const reset = await svc.resetRun('cellA', { userGoal: 'fresh start', reason: 'user restart', force: true });
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.state.runId).not.toBe(first.runId);
    expect(reset.state.stage).toBe('planner');
    expect(reset.state.reviewCycles).toBe(0);
    expect(reset.state.userGoal).toBe('fresh start');
    expect(reset.state.activeDelegations).toBeUndefined();
    expect(reset.state.todo).toEqual([]);
    const oldArts = await svc.readArtifacts('cellA', first.runId);
    const newArts = await svc.readArtifacts('cellA', reset.state.runId);
    expect(oldArts.length).toBe(1);
    expect(newArts).toEqual([]);
  });

  it('createRun archives previous run into runHistory', async () => {
    const first = await svc.initState(cell, { userGoal: 'v1', runLabel: 'first' });
    await svc.advance('cellA', 'researcher');
    const second = await svc.createRun('cellA', { userGoal: 'v2', runLabel: 'second' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.runId).not.toBe(first.runId);
    expect(second.state.runHistory?.length).toBe(1);
    expect(second.state.runHistory?.[0]?.runId).toBe(first.runId);
    expect(second.state.runHistory?.[0]?.stage).toBe('researcher');
  });

  it('updateRun patches current flow without new runId', async () => {
    const first = await svc.initState(cell, { userGoal: 'old' });
    const updated = await svc.updateRun('cellA', {
      userGoal: 'new goal',
      runLabel: 'renamed',
      todo: [{ id: 't1', text: 'step 1' }],
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.state.runId).toBe(first.runId);
    expect(updated.state.userGoal).toBe('new goal');
    expect(updated.state.runLabel).toBe('renamed');
    expect(updated.state.todo).toEqual([{ id: 't1', text: 'step 1' }]);
  });

  it('activateRun restores archived run as current', async () => {
    const first = await svc.initState(cell, { userGoal: 'run-a' });
    await svc.advance('cellA', 'researcher');
    const second = await svc.createRun('cellA', { userGoal: 'run-b' });
    if (!second.ok) return;
    const activated = await svc.activateRun('cellA', first.runId);
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.state.runId).toBe(first.runId);
    expect(activated.state.stage).toBe('researcher');
    expect(activated.state.userGoal).toBe('run-a');
    expect(activated.state.runHistory?.some((h) => h.runId === second.state.runId)).toBe(true);
  });

  it('createRun rejects when active delegations in flight without force', async () => {
    const first = await svc.initState(cell, { userGoal: 'a' });
    cell = {
      ...cell,
      pipelineState: {
        ...first,
        activeDelegations: [{
          targetEndpointId: 'r',
          targetRole: 'researcher',
          runId: first.runId,
          requireArtifact: false,
          delegateText: 'working',
          updatedAt: Date.now(),
        }],
      },
    };
    const blocked = await svc.createRun('cellA', { userGoal: 'b' });
    expect(blocked.ok).toBe(false);
    const forced = await svc.createRun('cellA', { userGoal: 'b', force: true });
    expect(forced.ok).toBe(true);
  });

  it('advance rejects when active delegations in flight', async () => {
    const first = await svc.initState(cell, { userGoal: 'a' });
    cell = {
      ...cell,
      pipelineState: {
        ...first,
        activeDelegations: [{
          targetEndpointId: 'r',
          targetRole: 'researcher',
          runId: first.runId,
          requireArtifact: false,
          delegateText: 'working',
          updatedAt: Date.now(),
        }],
      },
    };
    const blocked = await svc.advance('cellA', 'researcher');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain('delegation');
    }
  });

  it('activateRun rejects when active delegations without force', async () => {
    const first = await svc.initState(cell, { userGoal: 'a' });
    await svc.advance('cellA', 'researcher');
    const second = await svc.createRun('cellA', { userGoal: 'b', force: true });
    if (!second.ok) return;
    cell = {
      ...cell,
      pipelineState: {
        ...second.state,
        activeDelegations: [{
          targetEndpointId: 'r',
          targetRole: 'researcher',
          runId: second.state.runId,
          requireArtifact: false,
          delegateText: 'working',
          updatedAt: Date.now(),
        }],
      },
    };
    const blocked = await svc.activateRun('cellA', first.runId);
    expect(blocked.ok).toBe(false);
    const forced = await svc.activateRun('cellA', first.runId, { force: true });
    expect(forced.ok).toBe(true);
  });

  it('listRuns returns active and archived entries', async () => {
    const first = await svc.initState(cell, { userGoal: 'a' });
    await svc.createRun('cellA', { userGoal: 'b' });
    const listed = svc.listRuns('cellA');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.runs.length).toBe(2);
    expect(listed.runs.filter((r) => r.active)).toHaveLength(1);
    expect(listed.runs.some((r) => r.runId === first.runId && !r.active)).toBe(true);
  });
});
