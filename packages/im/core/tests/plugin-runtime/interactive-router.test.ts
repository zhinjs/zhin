import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import type { Message } from '../../src/plugin-runtime/im/contracts.js';

const conversation = { endpoint: { adapter: 'test', id: 'test' }, kind: 'group' as const, id: 'room' };
const message = (content: string, generation = 1) => ({ content, conversation, generation }) as Message;

describe('Interactive fallback numbering', () => {
  it('recognizes expired labels for their exact endpoint/conversation, for a bounded extra TTL', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const router = new RuntimeInteractiveRouter(100);
      router.rememberFallback(conversation, 1, { '1': 'old:action:1' });
      clock.mockReturnValue(1100);
      expect(router.resolvePayload(message('1'))).toBeUndefined();
      expect(router.isExpiredFallback(message('1'))).toBe(true);
      expect(router.isExpiredFallback({ ...message('1'), conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } } } as Message)).toBe(false);
      expect(router.isExpiredFallback({ ...message('1'), conversation: { ...conversation, threadId: 'other' } } as Message)).toBe(false);
      expect(router.isExpiredFallback(message('2'))).toBe(false);
      clock.mockReturnValue(1200);
      expect(router.isExpiredFallback(message('1'))).toBe(false);
      expect(router.rememberFallback(conversation, 2, { '1': 'new:action:1' })).toEqual({ '2': 'new:action:1' });
    } finally { clock.mockRestore(); }
  });
  it('expires keyboards independently without reusing numbers after expiry or generation replacement', () => {
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const router = new RuntimeInteractiveRouter(100);
    try {
      expect(router.rememberFallback(conversation, 1, { '1': 'old' })).toEqual({ '1': 'old' });
      now += 50;
      expect(router.rememberFallback(conversation, 1, { '1': 'new' })).toEqual({ '2': 'new' });
      expect(router.resolvePayload(message('1'))).toBe('old');
      now += 51;
      expect(router.resolvePayload(message('1'))).toBeUndefined();
      expect(router.resolvePayload(message('2'))).toBe('new');
      // The old generation mapping is still live, so this proves isolation.
      expect(router.resolvePayload(message('2', 2))).toBeUndefined();
      now += 100;
      expect(router.rememberFallback(conversation, 2, { '1': 'replacement' })).toEqual({ '3': 'replacement' });
      expect(router.resolvePayload(message('2', 2))).toBeUndefined();
      expect(router.resolvePayload(message('3', 2))).toBe('replacement');
    } finally { clock.mockRestore(); }
  });

  it('shares an increasing counter while isolating lookup by conversation', () => {
    const router = new RuntimeInteractiveRouter();
    expect(router.rememberFallback(conversation, 1, { '1': 'a', cancel: 'stop' })).toEqual({ '1': 'a', cancel: 'stop' });
    expect(router.rememberFallback({ ...conversation, id: 'another' }, 1, { '1': 'b' })).toEqual({ '2': 'b' });
    expect(router.resolvePayload(message('2'))).toBeUndefined();
    expect(router.resolvePayload({ ...message('2'), conversation: { ...conversation, id: 'another' } } as Message)).toBe('b');
    expect(router.resolvePayload(message('cancel'))).toBe('stop');
  });

  it('routes prefixed fallback labels after the instance counter reaches multiple digits', () => {
    const router = new RuntimeInteractiveRouter();
    const map = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), `ttt:board:cell-${i}`]));
    expect(router.rememberFallback(conversation, 1, map)['10']).toBe('ttt:board:cell-9');
    expect(router.resolvePayload(message('@bot ttt 10'))).toBe('ttt:board:cell-9');
    expect(router.resolvePayload(message('ttt 11'))).toBeUndefined();
  });
});
