import { describe, expect, it, vi } from 'vitest';
import { REACTION_SEGMENT_TYPE } from '@zhin.js/agent';
import { reactionOf } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { sendOutputMessages } from '../../../../src/plugin-runtime/agent/turn/reply-messages.js';

const reaction = (emoji: string) => ({ type: 'message' as const, segments: [{ type: REACTION_SEGMENT_TYPE, data: { emoji } }] });
const text = (value: string) => ({ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: value } }] });

describe('reaction output', () => {
  it('recognises only a reaction-only message', () => {
    expect(reactionOf([reaction('76')] as never)).toBe('76');
    expect(reactionOf([text('好')] as never)).toBeUndefined();
    expect(reactionOf([reaction('76'), text('好')] as never)).toBeUndefined();
    expect(reactionOf([reaction('')] as never)).toBeUndefined();
  });

  it('reacts first, then sends the words after a pause', async () => {
    const order: string[] = [];
    const pause = vi.fn(async () => { order.push('pause'); });
    const outcome = await sendOutputMessages([reaction('182'), text('哈哈哈')] as never, {
      render: message => JSON.stringify(message),
      pause,
      send: async message => {
        const emoji = reactionOf(message);
        order.push(emoji ? `react ${emoji}` : 'send');
        return { status: 'sent' };
      },
    });
    expect(order).toEqual(['react 182', 'pause', 'send']);
    expect(outcome.status).toBe('sent');
  });
});
