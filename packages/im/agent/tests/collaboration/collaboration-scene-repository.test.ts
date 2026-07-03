import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatabaseCollaborationSceneRepository,
  MemoryCollaborationSceneRepository,
} from '../../src/collaboration/collaboration-scene-repository.js';

describe('MemoryCollaborationSceneRepository', () => {
  let repo: MemoryCollaborationSceneRepository;

  beforeEach(() => {
    repo = new MemoryCollaborationSceneRepository();
  });

  it('upserts and lists cells', async () => {
    await repo.upsert({
      id: 'room-alpha',
      adapter: 'sandbox',
      sceneId: 'g1',
      members: [{ endpointId: 'planner-bot', primary: 'planner' }],
      goal: 'demo',
    });
    const cells = await repo.listEnabled();
    expect(cells).toHaveLength(1);
    expect(cells[0]?.goal).toBe('demo');
  });

  it('updates goal with optimistic version', async () => {
    await repo.upsert({
      id: 'room-alpha',
      adapter: 'sandbox',
      sceneId: 'g1',
      members: [{ endpointId: 'a', primary: 'planner' }],
    });
    const ok = await repo.updateGoal('room-alpha', '新目标', 0);
    expect(ok.ok).toBe(true);
    const conflict = await repo.updateGoal('room-alpha', '冲突', 0);
    expect(conflict.ok).toBe(false);
  });

  it('finds cell by scene', async () => {
    await repo.upsert({
      id: 'c1',
      adapter: 'qq',
      sceneId: '123',
      members: [{ endpointId: 'bot-a', primary: 'planner' }],
    });
    const found = await repo.findByScene('qq', '123');
    expect(found?.id).toBe('c1');
  });

  it('creates cell without members then adds via member API', async () => {
    await repo.upsert({ id: 'empty-room', adapter: 'sandbox', sceneId: 'g2' });
    const before = await repo.getById('empty-room');
    expect(before?.members).toEqual([]);

    const added = await repo.addMember('empty-room', { endpointId: 'bot-b', primary: 'writer' });
    expect(added.ok).toBe(true);

    const cell = await repo.getById('empty-room');
    expect(cell?.members).toHaveLength(1);
    expect(cell?.members[0]?.endpointId).toBe('bot-b');
  });

  it('finds cells by endpoint', async () => {
    await repo.upsert({
      id: 'room-a',
      adapter: 'sandbox',
      sceneId: 'g1',
      members: [{ endpointId: 'planner-bot', primary: 'planner' }],
    });
    await repo.upsert({
      id: 'room-b',
      adapter: 'sandbox',
      sceneId: 'g2',
      members: [
        { endpointId: 'planner-bot', primary: 'planner' },
        { endpointId: 'writer-bot', primary: 'writer' },
      ],
    });
    const cells = await repo.findScenesByEndpoint('planner-bot');
    expect(cells.map((c) => c.id).sort()).toEqual(['room-a', 'room-b']);
  });

  it('updates and removes members', async () => {
    await repo.upsert({
      id: 'room-m',
      adapter: 'sandbox',
      sceneId: 'g3',
      members: [{ endpointId: 'bot-x', primary: 'planner', role: 'lead' }],
    });
    const updated = await repo.updateMember('room-m', 'bot-x', { role: 'coordinator' });
    expect(updated.ok).toBe(true);
    expect(updated.member?.role).toBe('coordinator');

    const removed = await repo.removeMember('room-m', 'bot-x');
    expect(removed).toBe(true);
    const cell = await repo.getById('room-m');
    expect(cell?.members).toHaveLength(0);
  });

  it('updates member pipelineRole and preserves disabled state when omitted', async () => {
    await repo.upsert({
      id: 'room-pipeline',
      adapter: 'sandbox',
      sceneId: 'g5',
      members: [{
        endpointId: 'bot-reviewer',
        primary: 'reviewer',
        pipelineRole: 'reviewer',
        enabled: false,
      }],
    });

    const updated = await repo.updateMember('room-pipeline', 'bot-reviewer', {
      role: 'quality',
      pipelineRole: 'evaluator',
    });

    expect(updated.ok).toBe(true);
    expect(updated.member?.pipelineRole).toBe('evaluator');
    expect(updated.member?.enabled).toBe(false);

    const cell = await repo.getById('room-pipeline');
    expect(cell?.members).toHaveLength(0);
  });

  it('rejects duplicate member', async () => {
    await repo.upsert({
      id: 'room-dup',
      adapter: 'sandbox',
      sceneId: 'g4',
      members: [{ endpointId: 'bot-a', primary: 'planner' }],
    });
    const dup = await repo.addMember('room-dup', { endpointId: 'bot-a', primary: 'writer' });
    expect(dup.ok).toBe(false);
  });
});

describe('DatabaseCollaborationSceneRepository', () => {
  it('reads pipeline_state when SQLite dialect auto-parses JSON TEXT to object', async () => {
    const pipelineState = {
      runId: 'run-1',
      stage: 'researcher' as const,
      reviewCycles: 0,
      maxReviewCycles: 3,
      allowedNextStages: ['evaluator' as const],
      todo: [] as { id: string; text: string }[],
      pendingDelegateTarget: '210723495',
      taskBrief: '整理调研摘要',
      updatedAt: 1,
    };
    const cellRow = {
      id: 'cell-icqq-373460458',
      adapter: 'icqq',
      scene_id: '373460458',
      goal: '',
      mission_run_id: '',
      pipeline_state: pipelineState,
      round_state: '',
      version: 2,
      enabled: 1,
      created_at: 0,
      updated_at: 0,
    };
    const cellModel = {
      select: () => ({
        where: async (condition: Record<string, unknown>) =>
          condition.id === cellRow.id ? [cellRow] : [],
      }),
      create: async () => {},
      update: () => ({ where: async () => {} }),
    };
    const memberModel = {
      select: () => ({ where: async () => [] }),
      create: async () => {},
      update: () => ({ where: async () => {} }),
    };
    const repo = new DatabaseCollaborationSceneRepository(cellModel, memberModel);
    const cell = await repo.getById('cell-icqq-373460458');
    expect(cell?.pipelineState?.stage).toBe('researcher');
    expect(cell?.pipelineState?.pendingDelegateTarget).toBe('210723495');
    expect(cell?.pipelineState?.taskBrief).toBe('整理调研摘要');
  });
});
