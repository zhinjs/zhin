import { describe, expect, it, vi } from 'vitest';
import { SessionProfileStore } from '@zhin.js/agent';
import { observeSessionAndCheckSpeak } from '../../../../src/plugin-runtime/agent/turn/session-gate.js';

const conversation = { kind: 'group', id: 'g1', endpoint: { id: 'qq-bot', adapter: 'qq' } } as const;

function message(extra: Record<string, unknown> = {}) {
  return { conversation, sender: { id: 'u1', name: '小明', roles: ['admin'] }, metadata: {}, content: 'hi', ...extra } as any;
}

describe('observeSessionAndCheckSpeak', () => {
  it('blocks while the bot is muted and folds sender roles', async () => {
    const sessions = new SessionProfileStore();
    const events = {
      listBetween: vi.fn(async () => [
        { sequence: 5, event: { type: 'member.muted', member: { id: '10001' }, durationSeconds: 600, timestamp: Date.now() } },
      ]),
    } as any;
    const blocked = await observeSessionAndCheckSpeak({
      sessions, events, message: message(), platform: 'qq', scope: 'group', sceneId: 'g1',
      senderId: 'u1', endpointId: '10001', conversationSequence: 6,
    });
    expect(blocked).toBe('muted');
    expect(events.listBetween).toHaveBeenCalledWith(conversation, 0, 6, 50);
    expect((await sessions.get('qq', 'group', 'g1'))?.admins[0]).toMatchObject({ id: 'u1', role: 'admin' });
  });

  it('fails open when the store throws', async () => {
    const sessions = { observeInbound: async () => { throw new Error('db down'); } } as any;
    await expect(observeSessionAndCheckSpeak({
      sessions, events: undefined, message: message(), platform: 'qq', scope: 'group', sceneId: 'g1',
      senderId: 'u1', endpointId: 'x', conversationSequence: undefined,
    })).resolves.toBeNull();
  });

  it('is a no-op without a session store', async () => {
    await expect(observeSessionAndCheckSpeak({
      sessions: undefined, events: undefined, message: message(), platform: 'qq', scope: 'group', sceneId: 'g1',
      senderId: 'u1', endpointId: 'x', conversationSequence: 1,
    })).resolves.toBeNull();
  });
});
