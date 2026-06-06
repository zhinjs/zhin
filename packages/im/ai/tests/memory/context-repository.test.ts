import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryContextRepository,
  MemoryContextRepository,
} from '../../src/memory/context-repository.js';
import { MemoryAgentSessionStore } from '../../src/memory/agent-session-store.js';
import {
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '../../src/llm/index.js';
import {
  parseAgentMessageRow,
  serializeAgentMessage,
} from '../../src/memory/agent-db-models.js';

describe('ContextRepository', () => {
  let repository: MemoryContextRepository;
  let sessionStore: MemoryAgentSessionStore;
  let sessionId: string;

  beforeEach(async () => {
    const bundle = createMemoryContextRepository({ tailMessageLimit: 50 });
    repository = bundle.repository;
    sessionStore = bundle.sessionStore;
    const session = await sessionStore.getOrCreateActive({
      session_key: 'icqq:bot1:group:123',
      platform: 'icqq',
      bot_id: 'bot1',
      scene_id: '123',
      scene_type: 'group',
    });
    sessionId = session.session_id;
  });

  it('loadContext is epoch-only empty for new session', async () => {
    const ctx = await repository.loadContext(sessionId);
    expect(ctx.messages).toEqual([]);
    expect(ctx.systemPrompt).toBe('');
  });

  it('appendMessages and loadContext round-trip agent message JSON', async () => {
    const user = createUserMessage('hello');
    const assistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
      api: 'openai-completions',
      provider: 'p',
      model: 'm',
      usage: EMPTY_TOKEN_USAGE,
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    await repository.appendMessages(sessionId, [user, assistant]);

    const ctx = await repository.loadContext(sessionId);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]?.role).toBe('user');
    expect(ctx.messages[1]?.role).toBe('assistant');
  });

  it('saveSummary prepends summary user message on load', async () => {
    await repository.saveSummary(sessionId, 'User asked about weather.');
    await repository.appendMessages(sessionId, [createUserMessage('today?')]);

    const ctx = await repository.loadContext(sessionId);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]?.role).toBe('user');
    const first = ctx.messages[0];
    if (first?.role === 'user') {
      expect(first.content[0]?.type).toBe('text');
      if (first.content[0]?.type === 'text') {
        expect(first.content[0].text).toContain('weather');
      }
    }
  });

  it('serializes concurrent appendMessages for same session', async () => {
    const append = (text: string) =>
      repository.appendMessages(sessionId, [createUserMessage(text)]);

    await Promise.all([
      append('a'),
      append('b'),
      append('c'),
    ]);

    const ctx = await repository.loadContext(sessionId);
    expect(ctx.messages).toHaveLength(3);
    const texts = ctx.messages
      .filter((m) => m.role === 'user')
      .map((m) => (m.role === 'user' && m.content[0]?.type === 'text' ? m.content[0].text : ''));
    expect(texts.sort()).toEqual(['a', 'b', 'c']);
  });

  it('archiveSession archives active epoch', async () => {
    const archived = await repository.archiveSession('icqq:bot1:group:123');
    expect(archived).toBe(true);
    const active = await sessionStore.findActive('icqq:bot1:group:123');
    expect(active).toBeNull();
  });

  it('new epoch after archive has no prior messages (epoch-only)', async () => {
    await repository.appendMessages(sessionId, [createUserMessage('old')]);
    await repository.archiveSession('icqq:bot1:group:123');

    const next = await sessionStore.getOrCreateActive({
      session_key: 'icqq:bot1:group:123',
      platform: 'icqq',
      bot_id: 'bot1',
      scene_id: '123',
      scene_type: 'group',
    });
    expect(next.session_id).not.toBe(sessionId);

    const ctx = await repository.loadContext(next.session_id);
    expect(ctx.messages).toEqual([]);
  });
});

describe('agent-db-models serialization', () => {
  it('serialize/parse preserves toolResult role', () => {
    const msg = {
      role: 'toolResult' as const,
      toolCallId: 'c1',
      toolName: 'echo',
      content: [{ type: 'text' as const, text: 'pong' }],
      isError: false,
      timestamp: 1,
    };
    const row = serializeAgentMessage(msg);
    row.session_id = 's1';
    const parsed = parseAgentMessageRow(row);
    expect(parsed?.role).toBe('toolResult');
  });
});
