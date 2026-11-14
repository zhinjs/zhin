import { describe, expect, it } from 'vitest';
import {
  AccountStartupError, onceStartFailures, waitForFirstStartOutcomes,
} from '../../../src/instance/start-command.js';

/** `zhin start --once` start-up check (#1250): which accounts fail the run, and the CLI message. */
const row = (name: string, phase: string, extra: Record<string, unknown> = {}) => ({
  id: `adapter~${name}`, name, adapter: 'qq', status: phase === 'online' ? 'online' : 'offline', phase, ...extra,
});

describe('zhin start --once account failures', () => {
  it('counts failed and retrying accounts, not starting or login-pending ones', () => {
    const reasons = new Map([['adapter~bad', 'connect ECONNREFUSED 127.0.0.1:1'], ['adapter~retry', 'QQ WebSocket 403']]);
    const failures = onceStartFailures([
      row('ok', 'online'),
      row('slow', 'starting'),
      row('assist', 'awaiting_assist', { pendingLogin: true }),
      // A retrying account whose login flow waits for a person is a pending login, not a failure.
      row('login', 'retrying', { pendingLogin: true }),
      row('bad', 'failed', { lastError: { category: 'network', message: 'The platform could not be reached (ECONNREFUSED)' } }),
      row('retry', 'retrying', { lastError: { category: 'auth', message: 'The platform rejected the account credentials (Error)' } }),
      row('stopped', 'offline'),
    ], id => reasons.get(id));
    expect(failures).toEqual([
      { account: 'qq/bad', phase: 'failed', category: 'network', reason: 'connect ECONNREFUSED 127.0.0.1:1' },
      { account: 'qq/retry', phase: 'retrying', category: 'auth', reason: 'QQ WebSocket 403' },
    ]);
    // Without the masked raw message the classified summary is used.
    expect(onceStartFailures([row('bad', 'failed', { lastError: { category: 'config', message: 'summary' } })], () => undefined))
      .toEqual([{ account: 'qq/bad', phase: 'failed', category: 'config', reason: 'summary' }]);
  });

  it('leads the CLI message with the first failure and names every failed account', () => {
    const error = new AccountStartupError([
      { account: 'napcat/fixture', phase: 'retrying', category: 'network', reason: 'connect ECONNREFUSED 127.0.0.1:1' },
      { account: 'qq/main', phase: 'failed', category: 'config', reason: 'missing appid' },
    ]);
    expect(error.message).toBe('connect ECONNREFUSED 127.0.0.1:1 [napcat/fixture network, retrying]; 1 more account(s) failed to start: qq/main config');
    expect(new AccountStartupError([{ account: 'qq/main', phase: 'failed', reason: 'x' }]).message).toBe('x [qq/main]');
  });

  it('waits for first start attempts to settle, bounded by the deadline', async () => {
    let phase = 'starting';
    setTimeout(() => { phase = 'retrying'; }, 30);
    const started = Date.now();
    await waitForFirstStartOutcomes(() => [{ phase }, { phase: 'awaiting_assist', pendingLogin: true }], 5_000, 5);
    expect(phase).toBe('retrying');
    expect(Date.now() - started).toBeLessThan(5_000);
    // An account that never leaves `starting` does not hold --once past the deadline.
    const bounded = Date.now();
    await waitForFirstStartOutcomes(() => [{ phase: 'starting' }], 50, 5);
    expect(Date.now() - bounded).toBeGreaterThanOrEqual(45);
  });
});
