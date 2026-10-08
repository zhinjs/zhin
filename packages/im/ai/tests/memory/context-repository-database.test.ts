import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Registry } from '@zhin.js/database';
import {
  AGENT_MESSAGE_MODEL,
  AGENT_SESSION_MODEL,
  AGENT_SUMMARY_MODEL,
} from '../../src/memory/agent-db-models.js';
import { AgentSessionStore } from '../../src/memory/agent-session-store.js';
import { DatabaseContextRepository } from '../../src/memory/context-repository.js';
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
