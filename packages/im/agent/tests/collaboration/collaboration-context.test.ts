import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../../../core/src/message.js';
import {
  formatCollaborationSceneHint,
  resolveCollaborationSceneForMessage,
  resolveCollaborationTurnHint,
} from '../../src/collaboration/collaboration-context.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'icqq-collab-room',
  adapter: 'icqq',
  sceneId: '373460458',
  goal: 'ICQQ 多 Bot 同群协作',
  members: [
    { endpointId: '8596238', primary: 'planner', role: 'coordinator' },
    { endpointId: '210723495', primary: 'executor', role: 'worker' },
  ],
};

function groupMessage(endpoint: string, sceneId = '373460458'): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: sceneId },
    $sender: { id: 'user1' },
    $content: [],
  } as unknown as Message;
}

describe('formatCollaborationSceneHint', () => {
  it('lists self and peers for planner endpoint', () => {
    const hint = formatCollaborationSceneHint(cell, '8596238');
    expect(hint).toContain('8596238');
    expect(hint).toContain('planner');
    expect(hint).toContain('210723495');
    expect(hint).toContain('executor');
    expect(hint).toContain('Assignments and task handback are managed by the orchestration kernel');
    expect(hint).not.toContain('group_delegate');
    expect(hint).not.toContain('cell_pipeline_status');
  });
});

describe('resolveCollaborationTurnHint', () => {
  beforeEach(async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      goal: cell.goal,
      members: cell.members,
    });
    const svc = getCollaborationSceneService();
    svc.setRepository(repo);
    await svc.reloadFromRepository();
  });

  it('injects hint only for group cell member with peers', () => {
    const hint = resolveCollaborationTurnHint(groupMessage('8596238'));
    expect(hint).toContain('210723495');
    expect(hint).toContain('#taskId');
    expect(hint).not.toContain('group_delegate');
  });

  it('skips private chat', () => {
    const msg = {
      ...groupMessage('8596238'),
      $channel: { type: 'private', id: 'user1' },
    } as unknown as Message;
    expect(resolveCollaborationTurnHint(msg)).toBeUndefined();
  });

  it('skips group without matching cell', () => {
    expect(resolveCollaborationTurnHint(groupMessage('8596238', '999'))).toBeUndefined();
  });

  it('skips endpoint not in cell', () => {
    expect(resolveCollaborationTurnHint(groupMessage('unknown-bot'))).toBeUndefined();
  });

  it('resolveCollaborationSceneForMessage matches resolveCollaborationTurnHint gate', () => {
    const msg = groupMessage('8596238');
    expect(resolveCollaborationSceneForMessage(msg)?.id).toBe('icqq-collab-room');
    expect(resolveCollaborationTurnHint(msg)).toBeTruthy();
  });

  it('does not leak legacy pipeline delegatee hints from stored cell state', async () => {
    const svc = getCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    svc.setRepository(repo);
    await svc.reloadFromRepository();

    await svc.setPipelineState(cell.id, {
      runId: 'run-1',
      stage: 'researcher',
      reviewCycles: 0,
      maxReviewCycles: 3,
      allowedNextStages: ['evaluator'],
      todo: [],
      activeDelegations: [{
        targetEndpointId: '210723495',
        targetRole: 'researcher',
        runId: 'run-1',
        requireArtifact: false,
        delegateText: '整理调研摘要',
        mode: 'legacy-handoff',
        updatedAt: Date.now(),
      }],
      updatedAt: Date.now(),
    });

    const hint = resolveCollaborationTurnHint(groupMessage('210723495'));
    expect(hint).toContain('Assignments and peer mentions are managed by the orchestration kernel');
    expect(hint).not.toContain('[Active delegation]');
    expect(hint).not.toContain('整理调研摘要');
    expect(hint).not.toContain('[Delegate]');
  });

  it('does not inject legacy artifact-gate instructions when artifacts were required before migration', async () => {
    const svc = getCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    svc.setRepository(repo);
    await svc.reloadFromRepository();

    await svc.setPipelineState(cell.id, {
      runId: 'run-1',
      stage: 'researcher',
      reviewCycles: 0,
      maxReviewCycles: 3,
      allowedNextStages: ['evaluator'],
      todo: [],
      activeDelegations: [{
        targetEndpointId: '210723495',
        targetRole: 'researcher',
        runId: 'run-1',
        requireArtifact: true,
        artifactKinds: ['report', 'citations'],
        delegateText: '调研',
        mode: 'pipeline',
        updatedAt: Date.now(),
      }],
      updatedAt: Date.now(),
    });

    const hint = resolveCollaborationTurnHint(groupMessage('210723495'));
    expect(hint).not.toContain('cell_submit_artifact');
    expect(hint).not.toContain('report:{summary');
    expect(hint).not.toContain('citations:{sources');
  });

  it('does not inject legacy restart commands for ordinary planner turns', async () => {
    const svc = getCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    svc.setRepository(repo);
    await svc.reloadFromRepository();

    const hint = resolveCollaborationTurnHint(
      groupMessage('8596238'),
      '好的，重新启动 **Zhin 框架调研** 流程！',
    );
    expect(hint).not.toContain('[Pipeline restart]');
    expect(hint).not.toContain('cell_manage_pipeline');
  });

  it('does not inject legacy delegation scripts for ordinary planner turns', async () => {
    const svc = getCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    svc.setRepository(repo);
    await svc.reloadFromRepository();

    const hint = resolveCollaborationTurnHint(
      groupMessage('8596238'),
      '组织大家在群里按顺序同步项目进展',
    );
    expect(hint).not.toContain('requireArtifact=false');
    expect(hint).not.toContain('cell_submit_artifact');
  });
});
