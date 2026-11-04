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
  it('retains all confirmed bubbles including rich content and a prefix sent before failure', async () => {
    const conversation = { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group' as const, id: 'room' };
    const refs = ['first', 'card', 'last'].map(id => ({ conversation, id }));
    const p = port([{ status: 'sent', messageId: 'first', messages: refs.slice(0, 2) },
      { status: 'sent', messageId: 'last', messages: refs.slice(2) }]);
    await expect(sendOutputMessages([message('first and card'), message('last')], p))
      .resolves.toEqual({ status: 'sent', messageId: 'first', messages: refs });
    const partial = port([{ status: 'sent', messageId: 'first', messages: refs.slice(0, 1) },
      { status: 'failed', code: 'partial_delivery', retryable: false, messages: refs.slice(1, 2) }]);
    await expect(sendOutputMessages([message('first'), message('card then failure')], partial))
      .resolves.toEqual({ status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true, messages: refs.slice(0, 2) });
    expect(partial.send).toHaveBeenCalledTimes(2);
  });

  it('retains all successful canonical message references while preserving the first receipt id', async () => {
    const conversation = { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group' as const, id: 'room' };
    const refs = ['m1', 'm2'].map(id => ({ conversation, id }));
    const contexts = refs.map((message, index) => ({ message, plannedText: ['first', 'second'][index]! }));
    const p = port(contexts.map(context => ({ status: 'sent', messageId: context.message.id, messageContexts: [context] })));
    await expect(sendOutputMessages([message('first'), message('second')], p))
      .resolves.toEqual({ status: 'sent', messageId: 'm1', messageContexts: contexts });
    const partial = port([{ status: 'sent', messageId: 'm1', messageContexts: [contexts[0]!] }, { status: 'failed', code: 'transport', retryable: true }]);
    await expect(sendOutputMessages([message('first'), message('second')], partial))
      .resolves.toEqual({ status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true });
  });

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
      .resolves.toEqual({ status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true });
    const first = port([{ status: 'rejected', code: 'outbound_payload_rejected' }]);
    await expect(sendOutputMessages([message('a'), message('b')], first)).resolves.toEqual({ status: 'rejected', code: 'outbound_payload_rejected' });
    expect(first.sent).toEqual(['a']);
  });

  it('preserves a delivered prefix when a later reply port throws, and keeps the original error before any send', async () => {
    const conversation = { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group' as const, id: 'room' };
    const ref = { conversation, id: 'delivered' };
    const failure = new Error('reply lease unavailable');
    const p = port([{ status: 'sent', messageId: ref.id, messages: [ref] }]);
    p.send.mockRejectedValueOnce(failure);
    await expect(sendOutputMessages([message('first')], p)).rejects.toBe(failure);
    const later = port([]);
    later.send.mockResolvedValueOnce({ status: 'sent', messageId: ref.id, messages: [ref] }).mockRejectedValueOnce(failure);
    await expect(sendOutputMessages([message('first'), message('second')], later))
      .resolves.toEqual({ status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true, deliveryUnknown: true, messages: [ref] });
    expect(later.send).toHaveBeenCalledTimes(2);
  });

  it('is suppressed when nothing was sent', async () => {
    await expect(sendOutputMessages([], port([]))).resolves.toEqual({ status: 'suppressed' });
    await expect(sendOutputMessages([message('a')], port([{ status: 'suppressed' }]))).resolves.toEqual({ status: 'suppressed' });
  });
});
