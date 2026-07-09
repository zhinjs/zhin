import { describe, it, expect, beforeEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  shouldBlockDelegationAskUser,
  buildGroupAskUserFollowUp,
} from '../../src/collaboration/ask-user-bridge.js';
import { AskUserSessionService } from '../../src/builtin/ask-user-session-service.js';
import { isAskUserPendingReply } from '../../src/builtin/ask-user-session.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';
import type { Plugin } from '@zhin.js/core';

const GROUP_ID = '373460458';

async function seedCollabCell(): Promise<void> {
  resetCollaborationSceneService();
  const repo = new MemoryCollaborationSceneRepository();
  await repo.upsert({
    id: 'icqq-collab-room',
    adapter: 'icqq',
    sceneId: GROUP_ID,
    members: [
      { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
      { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
    ],
  });
  getCollaborationSceneService().setRepository(repo);
  await getCollaborationSceneService().reloadFromRepository();
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
  beforeEach(() => {
    AskUserSessionService.resetForTests();
  });

  it('marks pending private master reply via AskUserSessionService', async () => {
    let capturedMw: (m: import('@zhin.js/core').Message, next: () => Promise<void>) => Promise<void> = async () => {};
    const plugin = {
      root: {
        addMiddleware: (fn: typeof capturedMw) => {
          capturedMw = fn;
          return () => {};
        },
      },
    } as unknown as Plugin;
    const service = AskUserSessionService.install(plugin);
    const groupMsg = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: GROUP_ID,
    });
    const sendMessage = async () => 'sent';
    const adapter = { sendMessage } as never;

    const pending = service.open({
      sessionId: 's1',
      kind: 'sensitive_dm',
      message: groupMsg,
      questionType: 'confirm',
      args: { question: 'ok?' },
      timeoutMs: 5000,
      botMaster: '1659488338',
      adapter,
      groupOrigin: groupMsg,
    });

    const msg = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'private',
      senderId: '1659488338',
    });
    expect(isAskUserPendingReply(msg)).toBe(true);

    await capturedMw({ ...msg, $raw: 'yes' } as never, async () => {});
    await expect(pending).resolves.toContain('yes');
    expect(isAskUserPendingReply(msg)).toBe(false);
  });
});
