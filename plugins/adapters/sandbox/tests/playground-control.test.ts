import {
  PLAYGROUND_STORAGE_KEY,
  createDefaultPlaygroundState,
  loadPlaygroundState,
  reactPlaygroundMessage,
  recallPlaygroundMessage,
  type PlaygroundMessage,
  type PlaygroundStorage,
} from '../pages/index/playgroundState.js';

const message = (id: string, channelId = 'room', type: PlaygroundMessage['type'] = 'received'): PlaygroundMessage => ({
  id, type, channelType: 'group', channelId, channelName: 'Room', senderId: 'bot', senderName: 'Bot',
  content: [{ type: 'text', data: { text: id } }], timestamp: 1,
});

describe('Sandbox control frames on the page (ADR 0064 P1b)', () => {
  const scene = { type: 'group' as const, id: 'room' };

  it('recalls only the addressed message of the scene', () => {
    const messages = [message('a'), message('b'), message('a', 'other-room'), message('a', 'room', 'sent')];
    const next = recallPlaygroundMessage(messages, scene, 'a');
    expect(next.map((item) => item.recalled === true)).toEqual([true, false, false, true]);
  });

  it('adds and removes reactions by id without touching other messages', () => {
    let messages = [message('a'), message('b')];
    messages = reactPlaygroundMessage(messages, scene, { messageId: 'a', reactionId: 'r1', emoji: '👍', op: 'add' });
    messages = reactPlaygroundMessage(messages, scene, { messageId: 'a', reactionId: 'r2', emoji: '🎉', op: 'add' });
    expect(messages[0]!.reactions).toEqual([{ id: 'r1', emoji: '👍' }, { id: 'r2', emoji: '🎉' }]);
    expect(messages[1]!.reactions).toBeUndefined();
    messages = reactPlaygroundMessage(messages, scene, { messageId: 'a', reactionId: 'r1', op: 'remove' });
    messages = reactPlaygroundMessage(messages, scene, { messageId: 'a', reactionId: 'r2', op: 'remove' });
    expect('reactions' in messages[0]!).toBe(false);
  });

  it('persists well-formed reactions and drops malformed ones', () => {
    const values = new Map<string, string>();
    const storage: PlaygroundStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
    const state = createDefaultPlaygroundState();
    values.set(PLAYGROUND_STORAGE_KEY, JSON.stringify({ ...state, messages: [{
      ...message('a', state.sessions[1]!.id), reactions: [{ id: 'r1', emoji: '👍' }, { id: 7, emoji: 'x' }, { id: 'r3' }],
    }] }));
    expect(loadPlaygroundState(storage).messages[0]!.reactions).toEqual([{ id: 'r1', emoji: '👍' }]);
  });
});
