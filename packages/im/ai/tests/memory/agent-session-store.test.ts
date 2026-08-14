import { describe, expect, it, vi } from 'vitest';
import { Registry } from '@zhin.js/database';
import {
  AGENT_SESSION_MODEL,
  AgentSessionStore,
  PersistenceUnavailableError,
} from '../../src/index.js';

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
