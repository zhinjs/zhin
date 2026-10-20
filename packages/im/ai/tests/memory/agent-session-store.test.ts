import { describe, expect, it, vi } from 'vitest';
import { Registry } from '@zhin.js/database';
import {
  AGENT_SESSION_MODEL,
  AgentSessionStore,
  MemoryAgentSessionStore,
  PersistenceUnavailableError,
} from '../../src/index.js';

describe('AgentSessionRepository identity', () => {
  it('shares one active epoch when the same session is first opened concurrently', async () => {
    const store = new MemoryAgentSessionStore();
    const records = await Promise.all([
      store.getOrCreateActive({ session_key: 'concurrent' }),
      store.getOrCreateActive({ session_key: 'concurrent' }),
    ]);
    expect(records[0]?.session_id).toBe(records[1]?.session_id);
    expect((await store.findActive('concurrent'))?.session_id).toBe(records[0]?.session_id);
  });

  it('serializes first creation in the persistent sqlite store', async () => {
    const db = Registry.create('sqlite', { filename: ':memory:' });
    db.define('agent_sessions', AGENT_SESSION_MODEL);
    await db.start();
    try {
      const store = new AgentSessionStore(db.model('agent_sessions'));
      const records = await Promise.all([
        store.getOrCreateActive({ session_key: 'sqlite:concurrent' }),
        store.getOrCreateActive({ session_key: 'sqlite:concurrent' }),
      ]);
      expect(records[0]?.session_id).toBe(records[1]?.session_id);
      const rows = await db.model('agent_sessions').select().where({ session_key: 'sqlite:concurrent', status: 'active' });
      expect(rows).toHaveLength(1);
    } finally { await db.stop(); }
  });

  it('keeps other keys independent and releases a failed creation before the same-key retry', async () => {
    const rows: Record<string, unknown>[] = [];
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let attemptsA = 0;
    const store = new AgentSessionStore({
      select: () => ({ where: async (condition) => rows.filter((row) => Object.entries(condition).every(([key, value]) => row[key] === value)) as never }),
      create: async (record) => {
        if (record.session_key === 'A' && ++attemptsA === 1) {
          entered(); await gate; throw new Error('temporary write failure');
        }
        rows.push(record);
      },
      update: () => ({ where: async () => undefined }),
    });
    const first = store.getOrCreateActive({ session_key: 'A' });
    const rejected = expect(first).rejects.toMatchObject({ name: 'PersistenceUnavailableError', operation: 'agent_session.create' });
    await started;
    const retry = store.getOrCreateActive({ session_key: 'A' });
    expect((await store.getOrCreateActive({ session_key: 'B' })).session_key).toBe('B');
    expect(rows.map((row) => row.session_key)).toEqual(['B']);
    release();
    await rejected;
    const recovered = await retry;
    expect(recovered.session_key).toBe('A');
    expect(attemptsA).toBe(2);
    expect((await store.getOrCreateActive({ session_key: 'A' })).session_id).toBe(recovered.session_id);
    expect(rows.filter((row) => row.session_key === 'A')).toHaveLength(1);
  });

  it('creates collision-resistant epoch ids without shared counters', async () => {
    const firstStore = new MemoryAgentSessionStore();
    const secondStore = new MemoryAgentSessionStore();
    const first = await firstStore.getOrCreateActive({ session_key: 'shared' });
    const second = await secondStore.getOrCreateActive({ session_key: 'shared' });

    expect(first.session_id).toMatch(/^shared#[0-9a-f-]{36}$/);
    expect(second.session_id).toMatch(/^shared#[0-9a-f-]{36}$/);
    expect(first.session_id).not.toBe(second.session_id);
  });
});

describe('AgentSessionStore persistence failures', () => {
  it('does not reinterpret a failed active-session lookup as NotFound', async () => {
    const create = vi.fn();
    const store = new AgentSessionStore({
      select: () => ({ where: async () => { throw new Error('database offline'); } }),
      create,
      update: () => ({ where: async () => undefined }),
    });

    await expect(store.getOrCreateActive({ session_key: 'http:session-1' }))
      .rejects.toMatchObject({
        name: 'PersistenceUnavailableError',
        operation: 'agent_session.find_active',
      });
    expect(create).not.toHaveBeenCalled();
  });

  it('fails closed when session metadata writes fail', async () => {
    const store = new AgentSessionStore({
      select: () => ({ where: async () => [] }),
      create: async () => undefined,
      update: () => ({ where: async () => { throw new Error('database offline'); } }),
    });

    await expect(store.touch('session-1')).rejects.toBeInstanceOf(PersistenceUnavailableError);
  });
});

describe('AgentSessionStore sqlite leftover IM columns', () => {
  it('fails agent_session.create until leftover NOT NULL IM columns are dropped', async () => {
    const db = Registry.create('sqlite', { filename: ':memory:' });
    await db.start();
    await db.query(`
      CREATE TABLE "agent_sessions" (
        session_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        scene_type TEXT NOT NULL,
        model TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0
      )
    `);
    db.define('agent_sessions', AGENT_SESSION_MODEL);
    const store = new AgentSessionStore(db.model('agent_sessions'));

    await expect(store.getOrCreateActive({ session_key: 'http:session-1' }))
      .rejects.toMatchObject({
        name: 'PersistenceUnavailableError',
        operation: 'agent_session.create',
      });

    for (const column of ['platform', 'endpoint_id', 'scene_id', 'scene_type']) {
      await db.query(`ALTER TABLE "agent_sessions" DROP COLUMN "${column}"`);
    }

    const record = await store.getOrCreateActive({ session_key: 'http:session-1' });
    expect(record.session_key).toBe('http:session-1');
    await db.stop();
  });
});
