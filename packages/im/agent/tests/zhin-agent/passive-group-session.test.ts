import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordPassiveGroupObservation,
  consumePassiveGroupContextForTurn,
} from '../../src/session/passive-group-session.js';

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

  it('records and drains by canonical session identity', async () => {
    const sessionKey = 'pipeline:aaaaaaaa:icqq:8596238:group:373460458';
    await recordPassiveGroupObservation(agentStub(), {
      sessionKey,
      senderId: 'u1',
      senderName: 'Ada',
      text: '旁听内容',
    });

    const block = consumePassiveGroupContextForTurn(sessionKey);
    expect(block).toContain('旁听内容');
    expect(block).toContain('Ada');
  });
});
