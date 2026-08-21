import {
  PLAYGROUND_STORAGE_KEY,
  createDefaultPlaygroundState,
  loadPlaygroundState,
  savePlaygroundState,
  type PlaygroundStorage,
} from './playgroundState.js';

class MemoryStorage implements PlaygroundStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('sandbox playground persistence', () => {
  it('round-trips sessions, messages and per-session run configuration', () => {
    const storage = new MemoryStorage();
    const initial = createDefaultPlaygroundState('/workspace/zhin');
    const sessions = initial.sessions.map((session, index) => index === 0
      ? { ...session, runConfig: { ...session.runConfig, safetyMode: 'read-only' as const, networkAccess: true } }
      : session);
    expect(savePlaygroundState({
      activeSessionId: sessions[0]!.id,
      sessions,
      messages: [{
        id: 'm1', type: 'sent', channelType: 'private', channelId: sessions[0]!.id,
        channelName: sessions[0]!.name, senderId: 'owner', senderName: 'Owner',
        content: [{ type: 'text', data: { text: 'hello' } }], timestamp: 42,
        interactionResolved: true,
      }],
    }, storage)).toBe(true);

    const restored = loadPlaygroundState(storage);
    expect(restored.activeSessionId).toBe('sandbox-user');
    expect(restored.sessions[0]?.runConfig).toMatchObject({
      workingDirectory: '/workspace/zhin', safetyMode: 'read-only', networkAccess: true,
    });
    expect(restored.messages[0]).toMatchObject({ id: 'm1', channelId: 'sandbox-user', interactionResolved: true });
  });

  it('fails closed to defaults for malformed storage', () => {
    const storage = new MemoryStorage();
    storage.values.set(PLAYGROUND_STORAGE_KEY, '{broken');
    expect(loadPlaygroundState(storage).sessions.map((session) => session.id)).toEqual([
      'sandbox-user', 'sandbox-group', 'sandbox-channel',
    ]);
  });

  it('does not silently accept an unknown persisted schema version', () => {
    const storage = new MemoryStorage();
    storage.values.set(PLAYGROUND_STORAGE_KEY, JSON.stringify({ version: 2, sessions: [] }));
    expect(loadPlaygroundState(storage).activeSessionId).toBe('sandbox-user');
  });

  it('keeps complete message history instead of silently trimming old entries', () => {
    const storage = new MemoryStorage();
    const initial = createDefaultPlaygroundState('/workspace/zhin');
    const messages = Array.from({ length: 240 }, (_, index) => ({
      id: `m${index}`,
      type: 'sent' as const,
      channelType: 'private' as const,
      channelId: initial.sessions[0]!.id,
      channelName: initial.sessions[0]!.name,
      senderId: 'owner',
      senderName: 'Owner',
      content: [{ type: 'text', data: { text: `message ${index}` } }],
      timestamp: index,
    }));
    expect(savePlaygroundState({
      activeSessionId: initial.activeSessionId,
      sessions: initial.sessions,
      messages,
    }, storage)).toBe(true);
    expect(loadPlaygroundState(storage).messages).toHaveLength(240);
  });

  it('keeps sessions with the same id isolated by scope', () => {
    const storage = new MemoryStorage();
    const initial = createDefaultPlaygroundState('/workspace/zhin');
    const sessions = [
      { ...initial.sessions[0]!, id: 'shared', type: 'private' as const },
      { ...initial.sessions[1]!, id: 'shared', type: 'group' as const },
    ];
    expect(savePlaygroundState({
      activeSessionId: 'shared',
      activeSessionType: 'group',
      sessions,
      messages: sessions.map((session, index) => ({
        id: `m${index}`,
        type: 'sent' as const,
        channelType: session.type,
        channelId: session.id,
        channelName: session.name,
        senderId: 'owner',
        senderName: 'Owner',
        content: [{ type: 'text', data: { text: session.type } }],
        timestamp: index,
      })),
    }, storage)).toBe(true);

    const restored = loadPlaygroundState(storage);
    expect(restored.activeSessionType).toBe('group');
    expect(restored.messages.map((message) => message.channelType)).toEqual(['private', 'group']);
  });
});
