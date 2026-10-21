import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSystem } from '../../src/session/session-system.js';
import { SimpleSessionStrategy } from '../../src/session/strategies.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('SessionSystem exports', () => {
  it('SimpleSessionStrategy resolves session key from message transport', () => {
    const strategy = new SimpleSessionStrategy();
    const key = strategy.resolveSessionKey(mockCommMessage({
      adapter: 'sandbox',
      endpoint: 'bot',
      senderId: 'u1',
      scope: 'private',
    }));
    expect(key).toContain('sandbox');
  });
});

describe('SessionSystem.waitForPersistence (#857)', () => {
  const settledAfterMicrotasks = async (promise: Promise<void>) => {
    let settled = false;
    void promise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    return settled;
  };

  afterEach(() => { vi.useRealTimers(); });

  it('returns at once when readiness was already marked', async () => {
    vi.useFakeTimers();
    const sessions = new SessionSystem();
    sessions.markPersistenceReady();
    expect(await settledAfterMicrotasks(sessions.waitForPersistence())).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wakes every waiter when readiness arrives and clears their fallback timers', async () => {
    vi.useFakeTimers();
    const sessions = new SessionSystem();
    const first = sessions.waitForPersistence();
    const second = sessions.waitForPersistence();
    expect(vi.getTimerCount()).toBe(2);
    sessions.markPersistenceReady();
    await Promise.all([first, second]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('only falls back to in-memory after the timeout when nothing marks readiness', async () => {
    vi.useFakeTimers();
    const sessions = new SessionSystem();
    const waiting = sessions.waitForPersistence();
    expect(await settledAfterMicrotasks(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await waiting;
    expect(sessions.isPersistenceReady()).toBe(true);
  });
});
