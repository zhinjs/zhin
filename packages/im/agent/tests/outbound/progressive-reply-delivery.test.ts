import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';
import { deliverProgressiveReply } from '../../src/outbound/progressive-reply-delivery.js';

const conversation = { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private' as const, id: 'user' };
const message = { conversation, id: 'physical-1' };
const snapshot: ReplyStreamSnapshot = { revision: 2, messages: [{ key: 'message-0', complete: true,
  segments: [{ key: 'segment-0', complete: true, value: { type: 'text', data: { text: 'confirmed plus planned tail' } } }] }] };
const output = [{ type: 'message' as const, segments: [{ type: 'text' as const, data: { text: 'confirmed plus planned tail' } }] }];
function fixture(receipt: DeliveryReceipt) {
  const stream: CoreReplyStream = { receipt, confirmed: [{ key: 'message-0/segment-0/0', message,
    segments: [{ type: 'text', data: { text: 'confirmed' } }] }],
    update: vi.fn(), finish: vi.fn(async () => receipt), cancel: vi.fn(async () => receipt) };
  return { stream, run: new ReplyStreamRun(stream) };
}

it('finishes the same containers and projects only confirmed content, without replaying the full reply', async () => {
  const { stream, run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const send = vi.fn();
  const result = await deliverProgressiveReply({ run, snapshot }, output, { send });
  expect(stream.finish).toHaveBeenCalledExactlyOnceWith(snapshot);
  expect(send).not.toHaveBeenCalled();
  expect(result.confirmedOutput).toEqual([{ type: 'message', segments: [{ type: 'text', data: { text: 'confirmed' } }] }]);
  expect(result.delivery).toMatchObject({ status: 'sent', messages: [message], messageContexts: [{ message, plannedText: 'confirmed' }] });
});

it('preserves the known prefix and uncertainty when cancellation stops the remaining reply', async () => {
  const { stream, run } = fixture({ status: 'failed', parts: [{ message }],
    failure: { code: 'cancelled', message: 'cancelled', retryable: false, deliveryUnknown: true } });
  const send = vi.fn();
  const result = await deliverProgressiveReply({ run }, [...output, { type: 'image', url: 'https://example.test/not-sent.png' }], { send });
  expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.finish).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  expect(result.delivery).toMatchObject({ status: 'failed', deliveryPartial: true, deliveryUnknown: true, messages: [message] });
  expect(JSON.stringify(result.confirmedOutput)).not.toContain('planned');
});

it('sends final-only reaction and generated media once through the authorized ordinary path', async () => {
  const { run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const extra = [{ type: 'message' as const, segments: [{ type: 'reaction', data: { emoji: 'ok' } }] },
    { type: 'image' as const, url: 'https://example.test/generated.png' }];
  const mediaMessage = { ...message, id: 'media-2' };
  const send = vi.fn(async () => ({ status: 'sent' as const, messages: [mediaMessage] }));
  const result = await deliverProgressiveReply({ run, snapshot }, [...output, ...extra], { send });
  expect(send).toHaveBeenCalledExactlyOnceWith(extra);
  expect(result.delivery).toMatchObject({ status: 'sent', messages: [message, mediaMessage] });
  expect(result.confirmedOutput.slice(1)).toEqual(extra);
});

it('does not claim a native rich body is known when only its identity is confirmed', async () => {
  const { stream, run } = fixture({ status: 'sent', message, parts: [{ message }] });
  Object.assign(stream, { confirmed: [{ key: 'rich', message, segments: [] }] });
  const result = await deliverProgressiveReply({ run, snapshot }, output, { send: vi.fn() });
  expect(result.delivery).toMatchObject({ messageContexts: [] });
  expect(JSON.stringify(result.confirmedOutput)).not.toContain('planned');
});

it.each([
  { status: 'failed' as const, code: 'tail_rejected', retryable: true },
  { status: 'failed' as const, code: 'tail_unknown', retryable: true, deliveryUnknown: true as const },
  { status: 'failed' as const, code: 'tail_partial', retryable: true, deliveryPartial: true as const },
])('a tail failure %j cannot make the confirmed body safe to retry', async extra => {
  const { run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const send = vi.fn(async () => extra);
  const result = await deliverProgressiveReply({ run, snapshot }, [...output, { type: 'image', url: 'https://example.test/generated.png' }], { send });
  expect(result.delivery).toMatchObject({ ...extra, retryable: false, deliveryPartial: true, messages: [message] });
  expect(result.confirmedOutput).toHaveLength(1);
  expect(send).toHaveBeenCalledOnce();
});

it.each(['not_sent', 'rejected', 'unknown'] as const)('preserves explicit %s evidence if the tail throws', async disposition => {
  const { EndpointDeliveryError } = await import('@zhin.js/im-contract');
  const { run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const send = vi.fn(async () => { throw new EndpointDeliveryError('tail_code', 'tail', disposition); });
  const result = await deliverProgressiveReply({ run, snapshot }, [...output, { type: 'image', url: 'https://example.test/generated.png' }], { send });
  expect(result.delivery).toMatchObject({ status: 'failed', code: 'tail_code', retryable: false, deliveryPartial: true, messages: [message] });
  expect('deliveryUnknown' in result.delivery).toBe(disposition === 'unknown');
});

it('reports the confirmed resource stop once without regenerating the original reply', async () => {
  const { run } = fixture({ status: 'failed', parts: [{ message }],
    failure: { code: 'stream_buffer_limit', message: 'resource limit', retryable: false } });
  const send = vi.fn(async () => ({ status: 'sent' as const }));
  const result = await deliverProgressiveReply({ run }, output, { send }, 'en');
  expect(send).toHaveBeenCalledExactlyOnceWith([{ type: 'text', content: 'The reply reached its resource limit and generation stopped. Content already sent is preserved.' }]);
  expect(result.delivery).toMatchObject({ status: 'failed', code: 'stream_buffer_limit', retryable: false, deliveryPartial: true });
  expect(JSON.stringify(result.confirmedOutput)).not.toContain('planned');
});

it.each(['not_sent', 'rejected', 'unknown'] as const)('retains completed tail slots when the remaining send throws %s', async disposition => {
  const { EndpointDeliveryError } = await import('@zhin.js/im-contract');
  const tailMessage = { conversation, id: 'tail-1' };
  const empty = { receipt: { status: 'suppressed' as const }, confirmed: [], update: vi.fn(),
    finish: vi.fn(async () => ({ status: 'suppressed' as const })), cancel: vi.fn(async () => ({ status: 'suppressed' as const })) };
  const send = vi.fn(async () => { throw new EndpointDeliveryError('tail_stopped', 'tail', disposition,
    { parts: [{ messageId: tailMessage.id }, {}] }); });
  const result = await deliverProgressiveReply({ run: new ReplyStreamRun(empty) },
    [{ type: 'image', url: 'https://example.test/generated.png' }], { send }, undefined, undefined, conversation);
  expect(result.delivery).toMatchObject({ status: disposition === 'rejected' ? 'rejected' : 'failed',
    code: 'tail_stopped', messages: [tailMessage, null], ...(disposition === 'rejected' ? {} : { deliveryPartial: true }) });
  expect(result.confirmedOutput).toEqual([]);
  expect(send).toHaveBeenCalledOnce();
});

it('keeps confirmed body slots before partially sent tail slots without inventing tail content', async () => {
  const { EndpointDeliveryError } = await import('@zhin.js/im-contract');
  const { run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const send = vi.fn(async () => { throw new EndpointDeliveryError('tail_unknown', 'tail', 'unknown',
    { parts: [{ messageId: 'tail-1' }, {}] }); });
  const result = await deliverProgressiveReply({ run, snapshot }, [...output,
    { type: 'image', url: 'https://example.test/not-confirmed.png' }], { send }, undefined, undefined,
    { ...conversation, id: 'different-origin' });
  expect(result.delivery).toMatchObject({ status: 'failed', deliveryPartial: true, deliveryUnknown: true,
    messages: [message, { conversation, id: 'tail-1' }, null] });
  expect(result.confirmedOutput).toEqual([{ type: 'message', segments: [{ type: 'text', data: { text: 'confirmed' } }] }]);
  expect(send).toHaveBeenCalledOnce();
});

it.each(['parts', 'message'] as const)('retains the canonical tail %s target instead of reconstructing it from origin or prefix', async shape => {
  const { EndpointDeliveryError } = await import('@zhin.js/im-contract');
  const { run } = fixture({ status: 'sent', message, parts: [{ message }] });
  const actual = { conversation: { ...conversation, id: 'redirected', threadId: 'topic' }, id: 'actual-tail' };
  const receipt: DeliveryReceipt = { status: 'failed', ...(shape === 'parts' ? { parts: [{ message: actual }, {}] } : { message: actual }) };
  const error = new EndpointDeliveryError('tail_error', 'tail', 'unknown', { receipt, parts: [{ messageId: 'legacy-id' }] });
  const send = vi.fn(async () => { throw error; });
  const result = await deliverProgressiveReply({ run, snapshot }, [...output,
    { type: 'image', url: 'https://example.test/not-confirmed.png' }], { send }, undefined, undefined, conversation);
  expect(result.delivery).toMatchObject({ status: 'failed', code: 'tail_error', deliveryPartial: true, deliveryUnknown: true,
    messages: [message, actual, ...(shape === 'parts' ? [null] : [])] });
  expect(result.confirmedOutput).toEqual([{ type: 'message', segments: [{ type: 'text', data: { text: 'confirmed' } }] }]);
  expect(send).toHaveBeenCalledOnce();
});

it('retains tail-only canonical references without an origin, prefix reference or optional target parameter', async () => {
  const { EndpointDeliveryError } = await import('@zhin.js/im-contract');
  const actual = { conversation: { ...conversation, id: 'redirected', threadId: 'topic' }, id: 'actual-tail' };
  const native: CoreReplyStream = { receipt: { status: 'suppressed' }, confirmed: [], update: vi.fn(),
    finish: async () => ({ status: 'suppressed' }), cancel: async () => ({ status: 'suppressed' }) };
  const send = vi.fn(async () => { throw new EndpointDeliveryError('tail_error', 'tail', 'unknown', {
    receipt: { status: 'failed', parts: [{ message: actual }, {}] }, parts: [{ messageId: 'legacy-id' }],
  }); });
  const result = await deliverProgressiveReply({ run: new ReplyStreamRun(native) },
    [{ type: 'image', url: 'https://example.test/not-confirmed.png' }], { send });
  expect(result.delivery).toMatchObject({ status: 'failed', code: 'tail_error', deliveryPartial: true, deliveryUnknown: true,
    messages: [actual, null] });
  expect(result.confirmedOutput).toEqual([]);
  expect(send).toHaveBeenCalledOnce();
});

it.each(['tail', 'limit'] as const)('marks %s sends as answer facts in the owning phase before the global terminal', async mode => {
  const { run } = fixture(mode === 'limit'
    ? { status: 'failed', parts: [{ message }], failure: { code: 'stream_buffer_limit', message: 'limit', retryable: false } }
    : { status: 'sent', message, parts: [{ message }] });
  const send = vi.fn(async () => ({ status: 'sent' as const }));
  const extra = { type: 'image' as const, url: 'https://example.test/generated.png' };
  const answer = { intent: 'answer' as const, phaseId: 'turn:answer:2' };
  await deliverProgressiveReply({ run, ...(mode === 'tail' ? { snapshot } : {}) }, mode === 'tail' ? [...output, extra] : output, { send }, 'en', answer);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![1]).toEqual(answer);
});
