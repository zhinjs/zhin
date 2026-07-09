import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  recordPassiveGroupMessage,
  consumePassiveGroupContextForTurn,
  resolvePassiveGroupSessionKey,
} from '../../src/session/passive-group-session.js';
import { attachCollaborationTurnSnapshot } from '../../src/collaboration/collaboration-turn-snapshot.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';
import type { Message } from '@zhin.js/core';

const cell: CollaborationScene = {
  id: 'room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
  ],
  pipelineState: {
    runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    runHistory: [],
    activeDelegations: [],
    phase: 'planning',
    updatedAt: 1,
  },
};

function agentStub() {
  return {
    agentSessionStore: {
      getOrCreateActive: vi.fn().mockResolvedValue({ session_id: 's1' }),
    },
  } as never;
}

describe('passive-group-session', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('record and drain share session key', async () => {
    const passive = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: '373460458',
      senderId: 'u1',
    });
    const recordKey = resolvePassiveGroupSessionKey(passive, cell);
    await recordPassiveGroupMessage(agentStub(), passive, '旁听内容', cell);

    const atMsg = mockCommMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      scope: 'group',
      sceneId: '373460458',
    }) as Message;
    attachCollaborationTurnSnapshot(atMsg, cell, '8596238');
    const drainKey = resolvePassiveGroupSessionKey(atMsg);
    expect(recordKey).toBe(drainKey);

    const block = consumePassiveGroupContextForTurn(atMsg);
    expect(block).toContain('旁听内容');
  });
});
