import { RuntimeInteractionCoordinator } from '../../packages/im/core/src/plugin-runtime/im/interaction-runtime.js';
import { RuntimeMessage, type Segment } from '../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { formatOutboundActions, formatCallbackSegments } from '../../plugins/adapters/telegram/src/protocol.js';

const conversation = { endpoint: { id: 'test-account', adapter: 'telegram' }, kind: 'group' as const, id: 'room' };

describe('UserInteraction producer → Telegram callback codec', () => {
  it('preserves real per-question tokens within Telegram limits and accepts the early callback once', async () => {
    const coordinator = new RuntimeInteractionCoordinator();
    let emitted: string[] = [];
    const answer = coordinator.create({ conversation, generation: 1, sender: { id: 'alice' }, $reply: async content => {
      const keyboard = (content as Segment[]).find(segment => segment.type === 'keyboard')!;
      const expected = (keyboard.data.rows as Array<Array<{ payload: string; mode: string }>>).flat();
      expect(expected).toHaveLength(2);
      expect(expected.every(button => button.mode === 'callback')).toBe(true);
      // The real platform codec consumes the current question's complete producer output.
      const action = formatOutboundActions('123', content).find(item => item.method === 'sendMessage');
      if (action?.method !== 'sendMessage') throw new Error('Expected Telegram sendMessage');
      emitted = action.params.reply_markup!.inline_keyboard.flat().map(button => button.callback_data);
      expect(emitted).toEqual(expected.map(button => button.payload));
      expect(new Set(emitted).size).toBe(2);
      for (const payload of emitted) {
        expect(payload).toMatch(/^zhin:ask:[\da-f-]{36}:\d+$/u);
        expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(64);
        expect(payload).not.toBe('yes'); expect(payload).not.toBe('no');
      }
      const callback = formatCallbackSegments({ id: 'callback', from: { id: 1 }, data: emitted[0]! });
      // Exercise the actual decoder and a callback arriving before delivery completes.
      expect(coordinator.resolveClaim(new RuntimeMessage(
        {
          conversation: conversation,
          content: '',
          sender: { id: 'alice' },
          metadata: {},
          segments: callback,
        },
        { generation: 1, reply: async () => ({ status: 'sent' }) },
      ))).toBe(true);
      return { status: 'sent' };
    } }).ask({ type: 'confirm', title: '确认继续？' });
    await expect(answer).resolves.toBe(true);
    expect(coordinator.resolveClaim(new RuntimeMessage(
      {
        conversation: conversation,
        content: '',
        sender: { id: 'alice' },
        metadata: {},
        segments: formatCallbackSegments({ id: 'replay', from: { id: 1 }, data: emitted[0]! }),
      },
      { generation: 1, reply: async () => ({ status: 'sent' }) },
    ))).toBe(false);
  });
});
