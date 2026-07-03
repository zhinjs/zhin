import { describe, it, expect, beforeEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  shouldBlockDelegationAskUser,
  buildGroupAskUserFollowUp,
} from '../../src/collaboration/ask-user-bridge.js';
import {
  registerPendingAskUser,
  clearPendingAskUser,
  isAskUserPendingReply,
} from '../../src/builtin/ask-user-session.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';

const GROUP_ID = '373460458';

async function seedCollabCell(): Promise<void> {
  resetCollaborationCellService();
  const repo = new MemoryCollaborationCellRepository();
  await repo.upsert({
    id: 'icqq-collab-room',
    adapter: 'icqq',
    sceneId: GROUP_ID,
    members: [
      { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
      { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
    ],
  });
  getCollaborationCellService().setRepository(repo);
  await getCollaborationCellService().reloadFromRepository();
}

describe('shouldBlockDelegationAskUser', () => {
  beforeEach(async () => {
    await seedCollabCell();
  });

  const groupMsg = mockCommMessage({
    adapter: 'icqq',
    endpoint: '8596238',
    scope: 'group',
    sceneId: GROUP_ID,
  });

  it('blocks confirm ask to authorize Researcher in group cell', () => {
    const err = shouldBlockDelegationAskUser(
      groupMsg,
      '是否授权我调用 Researcher 执行调研？',
      'confirm',
    );
    expect(err).toContain('orchestration_add_task');
  });

  it('allows requirement clarification', () => {
    const err = shouldBlockDelegationAskUser(
      groupMsg,
      '请补充对比维度',
      'text',
    );
    expect(err).toBeUndefined();
  });
});

describe('buildGroupAskUserFollowUp', () => {
  beforeEach(async () => {
    await seedCollabCell();
  });

  it('injects delegation mandate for group scene', () => {
    const msg = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: GROUP_ID,
    });
    const out = buildGroupAskUserFollowUp(msg, 'yes');
    expect(out).toContain('yes');
    expect(out).toContain('orchestration_add_task');
    expect(out).toContain(GROUP_ID);
    expect(out).toContain('210723495');
  });
});

describe('ask-user-session', () => {
  it('marks pending private master reply', () => {
    registerPendingAskUser({
      endpointId: '8596238',
      masterId: '1659488338',
      registeredAt: Date.now(),
    });
    const msg = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'private',
      senderId: '1659488338',
    });
    expect(isAskUserPendingReply(msg)).toBe(true);
    clearPendingAskUser('8596238', '1659488338');
    expect(isAskUserPendingReply(msg)).toBe(false);
  });
});
