import { describe, it, expect } from 'vitest';
import {
  checkAIAccess,
  resolveAIAccessConfig,
  DEFAULT_AI_ACCESS_DENY_MESSAGE,
} from '../src/built/ai-access.js';
import type { Message } from '../src/plugin-runtime/im/contracts.js';

function msg(overrides: Partial<Message<any>> = {}): Message<any> {
  return {
    sender: { id: 'u1', name: 'User' },
    conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, id: 'g1', kind: 'group' },
    clientAdapter: 'qq',
    endpointId: 'bot1',
    ...overrides,
  } as Message<any>;
}

describe('resolveAIAccessConfig', () => {
  it('defaults to open', () => {
    expect(resolveAIAccessConfig(undefined).mode).toBe('open');
  });

  it('uses global config when no endpoint scope', () => {
    const resolved = resolveAIAccessConfig({
      mode: 'whitelist',
      users: ['a'],
      groups: ['g2'],
    });
    expect(resolved).toEqual({
      mode: 'whitelist',
      users: ['a'],
      groups: ['g2'],
      denyMessage: DEFAULT_AI_ACCESS_DENY_MESSAGE,
    });
  });

  it('endpoint scope wins over global', () => {
    const resolved = resolveAIAccessConfig(
      { mode: 'open', users: ['global'], denyMessage: 'global' },
      { mode: 'closed', denyMessage: 'endpoint off', users: ['ep'] },
    );
    expect(resolved.mode).toBe('closed');
    expect(resolved.denyMessage).toBe('endpoint off');
    expect(resolved.users).toEqual(['ep']);
  });

  it('endpoint inherits global lists when omitted', () => {
    const resolved = resolveAIAccessConfig(
      { mode: 'whitelist', users: ['global-user'], groups: ['global-group'] },
      { mode: 'whitelist' },
    );
    expect(resolved.users).toEqual(['global-user']);
    expect(resolved.groups).toEqual(['global-group']);
  });
});

describe('checkAIAccess', () => {
  it('open allows all', () => {
    expect(checkAIAccess(msg(), { mode: 'open' }).allowed).toBe(true);
  });

  it('closed denies group silently', () => {
    const result = checkAIAccess(msg(), { mode: 'closed' });
    expect(result.allowed).toBe(false);
    expect(result.replyMessage).toBeUndefined();
  });

  it('closed denies private with message', () => {
    const result = checkAIAccess(
      msg({ conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, id: 'p1', kind: 'private' } }),
      { mode: 'closed', denyMessage: 'no ai' },
    );
    expect(result.allowed).toBe(false);
    expect(result.replyMessage).toBe('no ai');
  });

  it('whitelist allows by user id', () => {
    const result = checkAIAccess(msg({ sender: { id: 'vip', name: 'V' } }), {
      mode: 'whitelist',
      users: ['vip'],
    });
    expect(result.allowed).toBe(true);
  });

  it('whitelist allows by group id', () => {
    const result = checkAIAccess(msg({ conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, id: 'allowed-g', kind: 'group' } }), {
      mode: 'whitelist',
      groups: ['allowed-g'],
    });
    expect(result.allowed).toBe(true);
  });

  it('whitelist denies non-matched group silently', () => {
    const result = checkAIAccess(msg(), {
      mode: 'whitelist',
      users: ['other'],
      groups: ['other-g'],
    });
    expect(result.allowed).toBe(false);
    expect(result.replyMessage).toBeUndefined();
  });

  it('whitelist OR: user in list passes even if group not listed', () => {
    const result = checkAIAccess(
      msg({ sender: { id: 'u-ok', name: 'U' }, conversation: { endpoint: { adapter: 'qq', id: 'bot1' }, id: 'g-unknown', kind: 'group' } }),
      { mode: 'whitelist', users: ['u-ok'], groups: [] },
    );
    expect(result.allowed).toBe(true);
  });

  it('endpoint aiAccess overrides global open', () => {
    const result = checkAIAccess(
      msg({ clientAdapter: 'qq', endpointId: 'bot-a' }),
      { mode: 'open' },
      { mode: 'closed' },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('mode: closed');
  });

  it('endpoint whitelist overrides global open', () => {
    const result = checkAIAccess(
      msg({ sender: { id: 'guest', name: 'G' } }),
      { mode: 'open' },
      { mode: 'whitelist', users: ['vip'] },
    );
    expect(result.allowed).toBe(false);
  });
});
