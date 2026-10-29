import { describe, expect, it } from 'vitest';
import {
  createMemberChangedEvent,
  createMemberPresenceEvent,
  createUserMessage,
  isEventMessage,
} from '../../src/index.js';
import { createMemoryContextRepository } from '../../src/memory/context-repository.js';
import { estimateAgentMessageTokens } from '../../src/compaction/agent-message-tokens.js';

describe('event messages in agent_messages', () => {
  it('persist in arrival order and survive a reload', async () => {
    const { repository, sessionStore } = createMemoryContextRepository({ tailMessageLimit: 50 });
    const session = await sessionStore.getOrCreateActive({ session_key: 'icqq:bot:group:1' });
    const join = createMemberPresenceEvent({ timestamp: 1000, id: 'e1' }, { action: 'join', userId: '10002', sceneId: '1' });
    const change = createMemberChangedEvent({ timestamp: 2000 }, { operatorId: '10001', userId: '10002', field: 'role', value: 'admin' });
    await repository.appendMessages(session.session_id, [createUserMessage('hi', undefined, 500)]);
    await repository.appendMessages(session.session_id, [join]);
    await repository.appendMessages(session.session_id, [createUserMessage('yo', undefined, 3000), change]);

    const loaded = await repository.loadContext(session.session_id);
    expect(loaded.messages.map(message => message.role)).toEqual(['user', 'event', 'user', 'event']);
    const events = loaded.messages.filter(isEventMessage);
    expect(events.map(event => event.name)).toEqual([join.name, change.name]);
    expect(events[0]).toMatchObject({ kind: 'member_joined', id: 'e1', timestamp: 1000 });
    const rows = await repository.loadMessageRows(session.session_id);
    expect(rows.map(row => row.role).sort()).toEqual(['event', 'event', 'user', 'user']);
  });

  it('are tolerated by token estimation', () => {
    const event = createMemberPresenceEvent({ timestamp: 1 }, { action: 'join', userId: '1', sceneId: '2' });
    expect(estimateAgentMessageTokens(event)).toBeGreaterThan(0);
  });
});
