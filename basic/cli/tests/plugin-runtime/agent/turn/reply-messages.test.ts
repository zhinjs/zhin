import { describe, expect, it, vi } from 'vitest';
import type { AgentOutputElement, DeliveryOutcome } from '@zhin.js/agent';
import { followUpPauseMs, sendOutputMessages } from '../../../../src/plugin-runtime/agent/turn/reply-messages.js';

const message = (text: string): AgentOutputElement => ({ type: 'message', segments: [{ type: 'text', data: { text } }] });
const render = (output: readonly AgentOutputElement[]) =>
  output.map(element => element.type === 'message' ? String(element.segments[0]!.data.text) : '').join('');

function port(outcomes: DeliveryOutcome[]) {
  const sent: string[] = [];
  const pauses: number[] = [];
  return {
    sent, pauses,
    render,
    send: vi.fn(async (output: readonly AgentOutputElement[]) => { sent.push(render(output)); return outcomes.shift()!; }),
    pause: async (ms: number) => { pauses.push(ms); },
  };
}

describe('sendOutputMessages', () => {
  it('sends each model message in order with a short pause and reports the first receipt', async () => {
    const p = port([{ status: 'sent', messageId: 'm1' }, { status: 'sent', messageId: 'm2' }]);
    await expect(sendOutputMessages([message('调好了'), message('你再试试')], p)).resolves.toEqual({ status: 'sent', messageId: 'm1' });
    expect(p.sent).toEqual(['调好了', '你再试试']);
    expect(p.pauses).toEqual([followUpPauseMs('你再试试')]);
    expect(followUpPauseMs('x'.repeat(1_000))).toBe(1_500);
  });

  it('reports a failure after a delivered message as partial and never retryable', async () => {
    const p = port([{ status: 'sent', messageId: 'm1' }, { status: 'failed', code: 'endpoint_send_failed', retryable: true }]);
    await expect(sendOutputMessages([message('a'), message('b')], p))
      .resolves.toEqual({ status: 'failed', code: 'partial_delivery', retryable: false });
    const first = port([{ status: 'rejected', code: 'outbound_payload_rejected' }]);
    await expect(sendOutputMessages([message('a'), message('b')], first)).resolves.toEqual({ status: 'rejected', code: 'outbound_payload_rejected' });
    expect(first.sent).toEqual(['a']);
  });

  it('is suppressed when nothing was sent', async () => {
    await expect(sendOutputMessages([], port([]))).resolves.toEqual({ status: 'suppressed' });
    await expect(sendOutputMessages([message('a')], port([{ status: 'suppressed' }]))).resolves.toEqual({ status: 'suppressed' });
  });
});
