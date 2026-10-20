import { describe, expect, it } from 'vitest';
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
