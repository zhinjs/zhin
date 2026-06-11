import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMemoryContextRepository,
  DatabaseContextRepository,
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
      endpoint_id: 'bot1',
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

  it('loadContext applies sender extra for LLM while rows store clean payload', async () => {
    const user = createUserMessage('你是谁');
    await repository.appendMessages(sessionId, [user]);
    const rows = await repository.loadMessageRows(sessionId);
    const row = rows[0]!;
    row.extra = JSON.stringify({
      sender: {
        id: '1',
        name: '归雨',
        roles: ['master'],
        scope: 'group',
      },
    });
    const memRepo = repository as MemoryContextRepository & { messages: Map<string, unknown[]> };
    memRepo['messages'].set(sessionId, rows);

    const ctx = await repository.loadContext(sessionId);
    const first = ctx.messages[0];
    expect(first?.role).toBe('user');
    if (first?.role === 'user') {
      expect(first.content[0]).toMatchObject({
        type: 'text',
        text: '[sender:id=1 name=归雨 roles=master] 你是谁',
      });
    }
    const stored = parseAgentMessageRow(row);
    if (stored?.role === 'user') {
      expect(stored.content[0]).toMatchObject({ type: 'text', text: '你是谁' });
    }
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

  it('injects branch summary after anchor on active path', async () => {
    const u1 = createUserMessage('hello');
    const u2 = createUserMessage('branch');
    await repository.appendMessages(sessionId, [u1]);
    const rows = await repository.loadMessageRows(sessionId);
    const anchorId = rows[0]?.id;
    expect(anchorId).toBeDefined();
    await repository.saveSummary(sessionId, 'Abandoned branch recap.', {
      branchAnchorMessageId: anchorId,
    });
    await repository.setActiveLeaf(sessionId, anchorId!);
    await repository.appendMessages(sessionId, [u2]);

    const ctx = await repository.loadContext(sessionId);
    const texts = ctx.messages
      .filter(m => m.role === 'user')
      .map(m => (m.role === 'user' && m.content[0]?.type === 'text' ? m.content[0].text : ''));
    expect(texts.some(t => t.includes('Abandoned branch recap'))).toBe(true);
    expect(texts.some(t => t.includes('branch'))).toBe(true);
  });

  it('hasBranchSummary detects saved branch summary', async () => {
    await repository.saveSummary(sessionId, 'branch only', { branchAnchorMessageId: 42 });
    expect(await repository.hasBranchSummary(sessionId, 42)).toBe(true);
    expect(await repository.hasBranchSummary(sessionId, 99)).toBe(false);
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
      endpoint_id: 'bot1',
      scene_id: '123',
      scene_type: 'group',
    });
    expect(next.session_id).not.toBe(sessionId);

    const ctx = await repository.loadContext(next.session_id);
    expect(ctx.messages).toEqual([]);
  });
});

describe('DatabaseContextRepository parent_id chain', () => {
  it('advances parent_id using insert lastID (sqlite create omits id)', async () => {
    const stored: Array<Record<string, unknown>> = [];
    let lastID = 0;
    const messageModel = {
      select: () => ({
        where: async () =>
          stored.map((row, index) => ({
            id: row.id ?? index + 1,
            session_id: row.session_id,
            role: row.role,
            payload: row.payload,
            parent_id: row.parent_id ?? null,
            timestamp: row.timestamp,
          })),
      }),
      insert: vi.fn(async (data: Record<string, unknown>) => {
        lastID += 1;
        stored.push({ ...data, id: lastID });
        return { lastID };
      }),
      create: vi.fn(),
    };
    const summaryModel = {
      select: () => ({
        where: async () => [],
      }),
      create: vi.fn(),
    };
    const sessionStore = new MemoryAgentSessionStore();
    const session = await sessionStore.getOrCreateActive({
      session_key: 'db:test',
      platform: 'test',
      endpoint_id: 'b1',
      scene_id: 'u1',
      scene_type: 'private',
    });
    const repository = new DatabaseContextRepository(
      messageModel,
      summaryModel,
      sessionStore,
    );

    await repository.appendMessages(session.session_id, [
      createUserMessage('one'),
      createUserMessage('two'),
    ]);

    expect(messageModel.insert).toHaveBeenCalledTimes(2);
    expect(messageModel.create).not.toHaveBeenCalled();
    expect(stored[0]?.parent_id).toBeNull();
    expect(stored[1]?.parent_id).toBe(1);

    const active = await sessionStore.getBySessionId(session.session_id);
    expect(active?.active_leaf_message_id).toBe(2);
  });
});

describe('agent-db-models serialization', () => {
  it('parseAgentMessageRow accepts SQLite-preparsed object payload', () => {
    const msg = createUserMessage('from db object');
    const row = serializeAgentMessage(msg);
    row.session_id = 's1';
    row.payload = msg;
    const parsed = parseAgentMessageRow(row);
    expect(parsed?.role).toBe('user');
    if (parsed?.role === 'user' && parsed.content[0]?.type === 'text') {
      expect(parsed.content[0].text).toBe('from db object');
    }
  });

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
