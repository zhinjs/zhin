import { describe, expect, it, vi } from 'vitest';
import {
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
