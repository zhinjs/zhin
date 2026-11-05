import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Registry } from '@zhin.js/database';
import type {} from '@zhin.js/database/dialects/pg';
import {
  AGENT_MESSAGE_MODEL,
  AGENT_MESSAGE_QUERY_VERSION,
  AGENT_SESSION_MODEL,
  AGENT_SUMMARY_MODEL,
  agentMessageQueryFields,
  normalizeConversationEventId,
  parseAgentMessageRow,
} from '../../src/memory/agent-db-models.js';
import { AgentSessionStore } from '../../src/memory/agent-session-store.js';
import { DatabaseContextRepository } from '../../src/memory/context-repository.js';
import { indexMessageAliases } from '../../src/memory/message-alias.js';
import { projectParticipantHeaders } from '../../src/memory/participant-header.js';
import {
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
} from '../../src/llm/index.js';

type AgentDbSchema = {
  agent_sessions: Record<string, unknown>;
  agent_messages: Record<string, unknown>;
  agent_summaries: Record<string, unknown>;
};

const live = process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1';

describe('DatabaseContextRepository (sqlite)', () => {
  let db: ReturnType<typeof Registry.create<AgentDbSchema, 'sqlite'>>;
  let sessionId: string;

  beforeEach(async () => {
    db = Registry.create<AgentDbSchema, 'sqlite'>('sqlite', { filename: ':memory:' });
    db.define('agent_sessions', AGENT_SESSION_MODEL);
    db.define('agent_messages', AGENT_MESSAGE_MODEL);
    db.define('agent_summaries', AGENT_SUMMARY_MODEL);
    await db.start();

    const sessionStore = new AgentSessionStore(db.models.get('agent_sessions')!);
    const session = await sessionStore.getOrCreateActive({
      session_key: 'test:private:u1',
    });
    sessionId = session.session_id;
  });

  afterEach(async () => {
    await db.stop();
  });

  it('reloads one reply row with all delivered ids and stable part aliases from a SQLite tail', async () => {
    const store = new AgentSessionStore(db.models.get('agent_sessions')!);
    const createRepo = () => new DatabaseContextRepository(db.models.get('agent_messages')!, db.models.get('agent_summaries')!, store, { tailMessageLimit: 2 });
    await createRepo().appendMessages(sessionId, [
      { ...createUserMessage('start', undefined, 1, { subjectId: 'user' }), messageId: 'platform-inbound' },
      { role: 'assistant', content: [{ type: 'text', text: 'reply in two messages' }], api: 'test', provider: 'test', model: 'test',
        usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp: 2, assistantActor: { subjectId: 'bot' },
        messageId: 'platform-first', messageIds: ['platform-first', 'platform-second'] },
      { ...createUserMessage('about the second message', undefined, 3, { subjectId: 'user' }), messageId: 'platform-next',
        quote: { id: 'platform-second', text: 'second' } },
    ]);
    const rows = await db.query<Array<{ id: number; payload: string }>>(
      'SELECT id, payload FROM agent_messages WHERE session_id = ? ORDER BY id ASC', [sessionId],
    );
    expect(rows).toHaveLength(3);
    expect(typeof rows[1]!.id).toBe('number');
    expect(JSON.parse(rows[1]!.payload).messageIds).toEqual(['platform-first', 'platform-second']);
    const loaded = await createRepo().loadContext(sessionId);
    expect(loaded.messages).toHaveLength(2);
    const aliases = indexMessageAliases(loaded.messages);
    expect(aliases.idOf('m2')).toBe('platform-first');
    expect(aliases.idOf('m2.2')).toBe('platform-second');
    expect(aliases.idOf('m3')).toBe('platform-next');
    const rendered = projectParticipantHeaders(loaded.messages).map(message =>
      'content' in message ? message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '');
    expect(rendered[0]).toContain('id:m2;parts:m2,m2.2;');
    expect(rendered[1]).toContain('reply_to:m2.2;');
  });

  it('retains all branch destinations when switching back to root', async () => {
    const store = new AgentSessionStore(db.models.get('agent_sessions')!);
    const repo = new DatabaseContextRepository(db.models.get('agent_messages')!, db.models.get('agent_summaries')!, store);
    await repo.appendMessages(sessionId, [createUserMessage('root')]);
    const root = (await repo.listBranchPoints(sessionId))[0]!.messageId;
    await repo.appendMessages(sessionId, [createUserMessage('old branch')]);
    const old = (await repo.listBranchPoints(sessionId))[1]!.messageId;
    await repo.setActiveLeaf(sessionId, root);
    await repo.appendMessages(sessionId, [createUserMessage('new branch')]);
    const newest = (await store.getBySessionId(sessionId))!.active_leaf_message_id!;
    await repo.setActiveLeaf(sessionId, root);
    expect((await repo.listBranchPoints(sessionId)).map(p => p.messageId)).toEqual([root, old, newest]);
    expect((await repo.listBranchPoints(sessionId)).map(p => [p.parentMessageId, p.activePath])).toEqual([[null, true], [root, false], [root, false]]);
    expect(await repo.jumpToBranchIndex(sessionId, 2)).toMatchObject({ ok: true });
    expect((await store.getBySessionId(sessionId))!.active_leaf_message_id).toBe(old);
    expect((await repo.loadContext(sessionId)).messages).toHaveLength(2);
    expect(await repo.setActiveLeaf(sessionId, newest)).toBe(true);
    expect((await repo.loadMessageRows(sessionId)).map(r => r.parent_id)).toEqual([null, root, root]);
    expect((await repo.listBranchPoints(sessionId)).map(p => p.messageId)).toEqual([root, old, newest]);
  });

  it('appendMessages chains parent_id via insert lastID', async () => {
    const sessionStore = new AgentSessionStore(db.models.get('agent_sessions')!);
    const repository = new DatabaseContextRepository(
      db.models.get('agent_messages')!,
      db.models.get('agent_summaries')!,
      sessionStore,
    );

    const assistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      api: 'openai-completions',
      provider: 'p',
      model: 'm',
      usage: EMPTY_TOKEN_USAGE,
      stopReason: 'stop',
      timestamp: Date.now(),
    };

    await repository.appendMessages(sessionId, [
      createUserMessage('one'),
      assistant,
      createUserMessage('two'),
    ]);

    const rows = await db.query<Array<{ id: number; parent_id: number | null; role: string }>>(
      'SELECT id, parent_id, role FROM agent_messages WHERE session_id = ? ORDER BY id ASC',
      [sessionId],
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]?.parent_id).toBeNull();
    expect(rows[1]?.parent_id).toBe(rows[0]?.id);
    expect(rows[2]?.parent_id).toBe(rows[1]?.id);

    const session = await sessionStore.getBySessionId(sessionId);
    expect(session?.active_leaf_message_id).toBe(rows[2]?.id);
  });

  it('persists and hydrates conversation_events SSOT foreign key columns (query_version=2)', async () => {
    const sessionStore = new AgentSessionStore(db.models.get('agent_sessions')!);
    const repository = new DatabaseContextRepository(
      db.models.get('agent_messages')!,
      db.models.get('agent_summaries')!,
      sessionStore,
    );

    const userMsg = {
      ...createUserMessage('inbound message', undefined, 100, { subjectId: 'u1' }),
      messageId: 'plat-msg-10',
      conversationEventId: 101,
      conversationKey: 'qq:bot1:group:g9',
    };
    const assistantMsg: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'outbound reply' }],
      api: 'openai-completions',
      provider: 'p',
      model: 'm',
      usage: EMPTY_TOKEN_USAGE,
      stopReason: 'stop',
      timestamp: 200,
      messageId: 'plat-msg-11',
      messageIds: ['plat-msg-11', 'plat-msg-12'],
      conversationEventId: 102,
      conversationEventIds: [102, 103],
      conversationKey: 'qq:bot1:group:g9',
    };

    expect(normalizeConversationEventId(101)).toBe(101);
    expect(normalizeConversationEventId('102')).toBe(102);
    expect(normalizeConversationEventId(0)).toBeNull();
    expect(normalizeConversationEventId(-5)).toBeNull();
    expect(normalizeConversationEventId('abc')).toBeNull();

    expect(agentMessageQueryFields(userMsg)).toMatchObject({
      conversation_event_id: 101,
      conversation_key: 'qq:bot1:group:g9',
      platform_message_id: 'plat-msg-10',
      message_key: 'qq:bot1:group:g9:plat-msg-10',
      query_version: AGENT_MESSAGE_QUERY_VERSION,
    });
    expect(agentMessageQueryFields(assistantMsg)).toMatchObject({
      conversation_event_id: 102,
      conversation_key: 'qq:bot1:group:g9',
      platform_message_id: 'plat-msg-11',
      message_key: 'qq:bot1:group:g9:plat-msg-11',
      query_version: AGENT_MESSAGE_QUERY_VERSION,
    });

    await repository.appendMessages(sessionId, [userMsg, assistantMsg]);

    const rows = await db.query<Array<Record<string, unknown>>>(
      'SELECT * FROM agent_messages WHERE session_id = ? ORDER BY id ASC',
      [sessionId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      conversation_event_id: 101,
      conversation_key: 'qq:bot1:group:g9',
      platform_message_id: 'plat-msg-10',
      message_key: 'qq:bot1:group:g9:plat-msg-10',
      query_version: 2,
    });
    expect(rows[1]).toMatchObject({
      conversation_event_id: 102,
      conversation_key: 'qq:bot1:group:g9',
      platform_message_id: 'plat-msg-11',
      message_key: 'qq:bot1:group:g9:plat-msg-11',
      query_version: 2,
    });

    // Verify parseAgentMessageRow hydrates FK fields from SQL columns even if stripped from payload JSON
    const hydrated = parseAgentMessageRow({
      session_id: sessionId,
      role: 'user',
      payload: JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'raw' }], timestamp: 300 }),
      timestamp: 300,
      conversation_event_id: 555,
      conversation_key: 'qq:bot1:private:u1',
      platform_message_id: 'plat-555',
    });
    expect(hydrated).toMatchObject({
      conversationEventId: 555,
      conversationKey: 'qq:bot1:private:u1',
      platformMessageId: 'plat-555',
      messageId: 'plat-555',
    });
  });

  it('pushes down SQL projections for appendMessages, setActiveLeaf, hasBranchSummary, and saveCompactionSummary without full payload scans', async () => {
    const sessionStore = new AgentSessionStore(db.models.get('agent_sessions')!);
    const messageModel = db.models.get('agent_messages')!;
    const summaryModel = db.models.get('agent_summaries')!;
    const selectMsgSpy = vi.spyOn(messageModel, 'select');
    const selectSumSpy = vi.spyOn(summaryModel, 'select');

    const repository = new DatabaseContextRepository(messageModel, summaryModel, sessionStore);

    // 1. appendMessages should not call messageModel.select() when active_leaf_message_id or insert lastID is known
    selectMsgSpy.mockClear();
    await repository.appendMessages(sessionId, [
      createUserMessage('first message', undefined, 10),
      createUserMessage('second message', undefined, 20),
      createUserMessage('third message', undefined, 30),
    ]);
    // On first append when active_leaf_message_id is null, only select('id', 'timestamp') is used
    for (const call of selectMsgSpy.mock.calls) {
      expect(call).toEqual(['id', 'timestamp']);
    }

    // Subsequent append when active_leaf_message_id is set does zero message selects
    selectMsgSpy.mockClear();
    await repository.appendMessages(sessionId, [createUserMessage('fourth message', undefined, 40)]);
    expect(selectMsgSpy).not.toHaveBeenCalled();

    // 2. setActiveLeaf uses select('id') pushdown
    const allRows = await repository.loadMessageRows(sessionId);
    const secondId = allRows[1]!.id!;
    selectMsgSpy.mockClear();
    expect(await repository.setActiveLeaf(sessionId, secondId)).toBe(true);
    expect(selectMsgSpy).toHaveBeenCalledWith('id');
    expect(await repository.setActiveLeaf(sessionId, 999999)).toBe(false);

    // 3. hasBranchSummary uses select('branch_anchor_message_id', 'summary') pushdown
    await repository.saveSummary(sessionId, 'branch summary text', { branchAnchorMessageId: secondId });
    selectSumSpy.mockClear();
    expect(await repository.hasBranchSummary(sessionId, secondId)).toBe(true);
    expect(selectSumSpy).toHaveBeenCalledWith('branch_anchor_message_id', 'summary');
    expect(await repository.hasBranchSummary(sessionId, 999999)).toBe(false);

    // 4. saveCompactionSummary uses select('id', 'parent_id', 'role', 'timestamp') metadata pushdown
    await repository.setActiveLeaf(sessionId, allRows[3]!.id!);
    const loaded = await repository.loadContext(sessionId);
    selectMsgSpy.mockClear();
    // Note: row 2 has a branch summary, so [m1, m2, branchSummary(m2)] share anchor 2 at index 1 and 2;
    // slicing(0, 3) includes the branchSummary at the anchor boundary.
    const saved = await repository.saveCompactionSummary(
      sessionId,
      'compacted epoch summary',
      loaded.messages.slice(0, 3),
    );
    expect(saved).toBe(true);
    expect(selectMsgSpy).toHaveBeenCalledWith('id', 'parent_id', 'role', 'timestamp');

    // 5. resolveCompactionAnchorId short-circuits on metadata when path <= minKeepCount
    selectMsgSpy.mockClear();
    const shortAnchor = await repository.resolveCompactionAnchorId(sessionId, 10, 10);
    expect(shortAnchor).toBeUndefined();
    expect(selectMsgSpy).toHaveBeenCalledTimes(1);
    expect(selectMsgSpy).toHaveBeenCalledWith('id', 'parent_id', 'role', 'timestamp');
  });
});

describe('DatabaseContextRepository persistence failures', () => {
  it('does not reinterpret a failed context read as empty history', async () => {
    const failedModel = {
      select: () => ({ where: () => { throw new Error('database offline'); } }),
      create: async () => undefined,
    };
    const sessionStore = {
      getBySessionId: async () => null,
    };
    const repository = new DatabaseContextRepository(
      failedModel as never,
      failedModel as never,
      sessionStore as never,
    );

    await expect(repository.loadContext('session-1')).rejects.toMatchObject({
      name: 'PersistenceUnavailableError',
      operation: 'agent_context.load_summaries',
    });
  });
});

describe.skipIf(!live)('DatabaseContextRepository (postgresql)', () => {
  const db = Registry.create<AgentDbSchema, 'pg'>('pg', {
    host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432),
    user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
    password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin',
    database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
  });

  beforeAll(async () => {
    db.define('agent_sessions', AGENT_SESSION_MODEL);
    db.define('agent_messages', AGENT_MESSAGE_MODEL);
    db.define('agent_summaries', AGENT_SUMMARY_MODEL);
    await db.start();
    await db.query('DELETE FROM "agent_summaries"');
    await db.query('DELETE FROM "agent_messages"');
    await db.query('DELETE FROM "agent_sessions"');
  });

  afterAll(async () => {
    if (!db.isStarted) return;
    await db.query('DROP TABLE IF EXISTS "agent_summaries"');
    await db.query('DROP TABLE IF EXISTS "agent_messages"');
    await db.query('DROP TABLE IF EXISTS "agent_sessions"');
    await db.stop();
  });

  it('writes each appended message exactly once when INSERT returns no id', async () => {
    const sessionStore = new AgentSessionStore(db.models.get('agent_sessions')!);
    const session = await sessionStore.getOrCreateActive({ session_key: 'pg:private:u1' });
    const repository = new DatabaseContextRepository(
      db.models.get('agent_messages')!,
      db.models.get('agent_summaries')!,
      sessionStore,
    );

    await repository.appendMessages(session.session_id, [createUserMessage('one')]);

    await expect(db.query<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM "agent_messages" WHERE "session_id" = $1',
      [session.session_id],
    )).resolves.toEqual([{ count: 1 }]);
  });
});


describe('persistent sqlite branch navigation', () => {
  it('reopens all branches and the active leaf without changing ancestry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-session-tree-test-'));
    const filename = join(directory, 'sessions.sqlite');
    const open = async () => {
      const db = Registry.create<AgentDbSchema, 'sqlite'>('sqlite', { filename });
      db.define('agent_sessions', AGENT_SESSION_MODEL);
      db.define('agent_messages', AGENT_MESSAGE_MODEL);
      db.define('agent_summaries', AGENT_SUMMARY_MODEL);
      await db.start();
      const store = new AgentSessionStore(db.models.get('agent_sessions')!);
      return { db, store, repo: new DatabaseContextRepository(db.models.get('agent_messages')!, db.models.get('agent_summaries')!, store) };
    };
    let current = await open();
    try {
      const session = await current.store.getOrCreateActive({ session_key: 'fixture:private:branches' });
      const id = session.session_id;
      await current.repo.appendMessages(id, [createUserMessage('root'), createUserMessage('old')]);
      const root = (await current.repo.listBranchPoints(id))[0]!.messageId;
      await current.repo.setActiveLeaf(id, root);
      await current.repo.appendMessages(id, [createUserMessage('new')]);
      await current.repo.setActiveLeaf(id, root);
      const before = await current.repo.listBranchPoints(id);
      await current.db.stop();
      current = await open();
      expect(await current.repo.listBranchPoints(id)).toEqual(before);
      expect((await current.store.getBySessionId(id))?.active_leaf_message_id).toBe(root);
      for (const point of before.slice(1)) {
        expect(await current.repo.setActiveLeaf(id, point.messageId)).toBe(true);
        expect((await current.repo.loadContext(id)).messages).toHaveLength(2);
      }
      expect((await current.repo.loadMessageRows(id)).map(row => row.parent_id)).toEqual([null, root, root]);
    } finally {
      await current.db.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
