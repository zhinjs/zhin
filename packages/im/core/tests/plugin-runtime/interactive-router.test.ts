import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import type { Message } from '../../src/plugin-runtime/im/contracts.js';

const conversation = { endpoint: { adapter: 'test', id: 'test' }, kind: 'group' as const, id: 'room' };
const message = (content: string, generation = 1) => ({ content, conversation, generation }) as Message;

describe('Interactive fallback numbering', () => {
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
      now += 100;
      expect(router.rememberFallback(conversation, 2, { '1': 'replacement' })).toEqual({ '3': 'replacement' });
      expect(router.resolvePayload(message('2', 2))).toBeUndefined();
      expect(router.resolvePayload(message('3', 2))).toBe('replacement');
    } finally { clock.mockRestore(); }
  });

  it('isolates numbering by conversation and preserves explicitly named choices', () => {
    const router = new RuntimeInteractiveRouter();
    expect(router.rememberFallback(conversation, 1, { '1': 'a', cancel: 'stop' })).toEqual({ '1': 'a', cancel: 'stop' });
    expect(router.rememberFallback({ ...conversation, id: 'another' }, 1, { '1': 'b' })).toEqual({ '1': 'b' });
    expect(router.resolvePayload(message('cancel'))).toBe('stop');
  });
});
