import { describe, expect, it } from 'vitest';
import { formatUserContentForSession } from '../../src/session/session-io.js';
import { SimpleSessionStrategy } from '../../src/session/strategies.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('SessionSystem exports', () => {
  it('formatUserContentForSession adds sender prefix for group messages', () => {
    const commMessage = mockCommMessage({ senderId: 'real', scope: 'group', sceneId: 'g1' });
    const formatted = formatUserContentForSession(commMessage, 'hello');
    expect(formatted).toContain('[sender:id=real');
    expect(formatted).toContain('hello');
  });

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
