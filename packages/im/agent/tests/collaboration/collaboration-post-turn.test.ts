import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from '../../../core/src/message.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';
import { GroupDelegateTool } from '../../src/collaboration/collaboration-tools.js';
import { processCollaborationPostTurn } from '../../src/collaboration/collaboration-post-turn.js';
import { getPipelineService, setPipelineService } from '../../src/aop/pipeline/pipeline-service.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const cell: CollaborationCell = {
  id: 'icqq-room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: '1689919782', primary: 'evaluator', pipelineRole: 'evaluator' },
  ],
};

const pingMock = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../../src/collaboration/im-mention-delegate.js', () => ({
  sendGroupPeerMention: (...args: unknown[]) => pingMock(...args),
}));

vi.mock('../../src/collaboration/collaboration-outbound.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/collaboration/collaboration-outbound.js')>();
  return {
    ...actual,
    sendCollaborationMentionPayload: vi.fn().mockResolvedValue({ ok: true, endpointIds: ['210723495'] }),
  };
});

function groupMessage(endpoint: string, senderId = 'human-1'): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: '373460458' },
    $sender: { id: senderId },
    $content: [],
    $id: 'msg-1',
  } as unknown as Message;
}

const fakeRoot = {
  inject: () => ({
    endpoints: new Map([
      ['8596238', { $platformUserId: '8596238' }],
      ['210723495', { $platformUserId: '210723495' }],
      ['1689919782', { $platformUserId: '1689919782' }],
    ]),
  }),
} as unknown as import('@zhin.js/core').Plugin;

const adapter = {
  endpoints: new Map([
    ['8596238', { $platformUserId: '8596238' }],
    ['210723495', { $platformUserId: '210723495' }],
    ['1689919782', { $platformUserId: '1689919782' }],
  ]),
};

const introSegments = [
  { type: 'text' as const, data: { text: ' 大家好，我是 Researcher，擅长调研和整理资料。' } },
  { type: 'at' as const, data: { id: '8596238', qq: '8596238' } },
];

const logger = { info: vi.fn(), warn: vi.fn() };

describe.skip('legacy processCollaborationPostTurn harness', () => {
  beforeEach(async () => {
    pingMock.mockClear();
    logger.info.mockClear();
    resetCollaborationCellService();
    setPipelineService(null);
    const repo = new MemoryCollaborationCellRepository();
    await repo.upsert({
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      members: cell.members,
    });
    getCollaborationCellService().setRepository(repo);
    await getCollaborationCellService().reloadFromRepository();
  });

  it('human @planner does not auto-delegate (Planner must group_delegate)', async () => {
    await processCollaborationPostTurn({
      message: groupMessage('8596238'),
      endpointId: '8596238',
      inboundContent: '@planner 指挥大家做自我介绍',
      outboundOk: true,
      adapter,
      root: fakeRoot,
      logger,
    });

    const fresh = await getCollaborationCellService().getCellFresh(cell.id);
    expect(fresh?.pipelineState?.activeDelegations?.length ?? 0).toBe(0);
    expect(pingMock).not.toHaveBeenCalled();
  });

  it('delegatee handback clears activeDelegation without advancing stage', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { userGoal: '做自我介绍', profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
      activeDelegations: [{
        targetEndpointId: '210723495',
        targetRole: 'researcher',
        runId: 'run-1',
        requireArtifact: false,
        delegateText: '做自我介绍',
        mode: 'ceremony',
        updatedAt: Date.now(),
      }],
    });

    await processCollaborationPostTurn({
      message: groupMessage('210723495', '210723495'),
      endpointId: '210723495',
      inboundContent: '请researcher发言',
      outboundOk: true,
      outboundSegments: introSegments,
      sentOutboundSegments: introSegments,
      adapter,
      root: fakeRoot,
      logger,
    });

    const fresh = await svc.getCellFresh(cell.id);
    expect(fresh?.pipelineState?.stage).toBe('researcher');
    expect(fresh?.pipelineState?.ceremonySpoken).toContain('210723495');
    expect(fresh?.pipelineState?.activeDelegations?.[0]?.targetEndpointId).toBe('1689919782');
    expect(pingMock).toHaveBeenCalled();
  });

  it('handback harness runs when @ planner was stripped from sent but remains in raw', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'evaluator');
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
      activeDelegations: [{
        targetEndpointId: '1689919782',
        targetRole: 'evaluator',
        runId: 'run-1',
        requireArtifact: false,
        delegateText: '评估',
        mode: 'ceremony',
        updatedAt: Date.now(),
      }],
    });

    await processCollaborationPostTurn({
      message: groupMessage('1689919782', '1689919782'),
      endpointId: '1689919782',
      inboundContent: '@planner 任务',
      outboundOk: true,
      outboundSegments: introSegments,
      sentOutboundSegments: [{ type: 'text', data: { text: ' 大家好，我是 Evaluator，负责评估方案可行性。' } }],
      adapter,
      root: fakeRoot,
      logger,
    });

    expect(pingMock).toHaveBeenCalledOnce();
  });

  it('does not notify planner on empty outbound (silent turn)', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
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
    });

    await processCollaborationPostTurn({
      message: groupMessage('210723495', '210723495'),
      endpointId: '210723495',
      inboundContent: '任务',
      outboundOk: false,
      adapter,
      root: fakeRoot,
      logger,
    });

    expect(pingMock).not.toHaveBeenCalled();
  });

  it('notifies planner when artifacts missing (handback blocked)', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
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
    });

    await processCollaborationPostTurn({
      message: groupMessage('210723495', '210723495'),
      endpointId: '210723495',
      inboundContent: '任务',
      outboundOk: true,
      outboundSegments: [{ type: 'text', data: { text: ' {"ok":true,"cellId":"x"} ' } }],
      sentOutboundSegments: [{ type: 'text', data: { text: ' 摘要' } }],
      adapter,
      root: fakeRoot,
      logger,
    });

    expect(pingMock).toHaveBeenCalledOnce();
    expect(String(pingMock.mock.calls[0]?.[0]?.text)).toContain('缺少产物');
    const fresh = await svc.getCellFresh(cell.id);
    expect(fresh?.pipelineState?.activeDelegations).toHaveLength(1);
  });

  it.skip('legacy group_delegate writes activeDelegations with requireArtifact', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');

    const tool = new GroupDelegateTool(groupMessage('8596238'));
    const result = await tool.run({
      message: '{"mentions":["researcher"],"text":"请处理","requireArtifact":false,"mode":"ceremony"}',
    });
    expect(result.ok).toBe(true);

    const fresh = await svc.getCellFresh(cell.id);
    expect(fresh?.pipelineState?.activeDelegations).toHaveLength(1);
    expect(fresh?.pipelineState?.activeDelegations?.[0]?.targetEndpointId).toBe('210723495');
    expect(fresh?.pipelineState?.activeDelegations?.[0]?.requireArtifact).toBe(false);
  });

  it('ceremony blocks handback without substantive public intro', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { userGoal: '依次自我介绍', profile: 'full' });
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
      activeDelegations: [{
        targetEndpointId: '1689919782',
        targetRole: 'evaluator',
        runId: 'run-1',
        requireArtifact: false,
        delegateText: '自我介绍',
        mode: 'ceremony',
        updatedAt: Date.now(),
      }],
    });

    await processCollaborationPostTurn({
      message: groupMessage('1689919782', '1689919782'),
      endpointId: '1689919782',
      inboundContent: '任务',
      outboundOk: true,
      sentOutboundSegments: [{ type: 'text', data: { text: ' 已完成自我介绍 ✅' } }],
      adapter,
      root: fakeRoot,
      logger,
    });

    const fresh = await svc.getCellFresh(cell.id);
    expect(fresh?.pipelineState?.activeDelegations).toHaveLength(1);
    expect(pingMock).not.toHaveBeenCalled();
  });

  it('ceremony auto-advances to next roster member after substantive intro', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { userGoal: '依次自我介绍', profile: 'full' });
    await svc.setPipelineState(cell.id, {
      ...(await svc.getCellFresh(cell.id))!.pipelineState!,
      activeDelegations: [{
        targetEndpointId: '210723495',
        targetRole: 'researcher',
        runId: 'run-1',
        requireArtifact: false,
        delegateText: '自我介绍',
        mode: 'ceremony',
        updatedAt: Date.now(),
      }],
    });

    await processCollaborationPostTurn({
      message: groupMessage('210723495', '210723495'),
      endpointId: '210723495',
      inboundContent: '任务',
      outboundOk: true,
      sentOutboundSegments: [{ type: 'text', data: { text: ' 大家好，我是 Researcher，擅长调研。' } }],
      adapter,
      root: fakeRoot,
      logger,
    });

    const fresh = await svc.getCellFresh(cell.id);
    expect(fresh?.pipelineState?.ceremonySpoken).toContain('210723495');
    expect(fresh?.pipelineState?.activeDelegations?.[0]?.targetEndpointId).toBe('1689919782');
    expect(pingMock).toHaveBeenCalled();
  });

  it.skip('legacy pipeline mode respects requireArtifact=false from planner', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');

    const tool = new GroupDelegateTool(groupMessage('8596238'));
    const result = await tool.run({
      mentions: ['researcher'],
      text: '请调研',
      requireArtifact: false,
      mode: 'pipeline',
    });
    expect(result.ok).toBe(true);

    const fresh = await svc.getCellFresh(cell.id);
    const d = fresh?.pipelineState?.activeDelegations?.[0];
    expect(d?.requireArtifact).toBe(false);
    expect(d?.mode).toBe('ceremony');
    expect(d?.artifactKinds).toBeUndefined();
  });

  it.skip('legacy pipeline mode fills default artifactKinds when requireArtifact=true', async () => {
    const svc = getCollaborationCellService();
    await getPipelineService().ensureState(cell, { profile: 'full' });
    await getPipelineService().advance(cell.id, 'researcher');

    const tool = new GroupDelegateTool(groupMessage('8596238'));
    const result = await tool.run({
      mentions: ['researcher'],
      text: '请调研',
      requireArtifact: true,
      mode: 'pipeline',
    });
    expect(result.ok).toBe(true);

    const fresh = await svc.getCellFresh(cell.id);
    const d = fresh?.pipelineState?.activeDelegations?.[0];
    expect(d?.requireArtifact).toBe(true);
    expect(d?.artifactKinds).toEqual(['report', 'citations']);
  });
});
