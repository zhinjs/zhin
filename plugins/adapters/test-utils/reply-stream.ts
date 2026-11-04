import { vi } from 'vitest';
import type { EndpointChildLease, EndpointStreamRequest } from 'zhin.js/adapter';
import { createCoreReplyStream, type ReplyStreamSnapshot } from '../../../packages/im/core/src/plugin-runtime/im/progressive-reply.js';

/** Real Core/Endpoint stream boundary; only the Host delivery observer is mocked. */
export function coreReplyFixture(lease: EndpointChildLease, request: EndpointStreamRequest) {
  const streaming = lease.streaming;
  if (!streaming || streaming.supports?.({ conversation: request.conversation, source: request.source }) === false) {
    throw new Error('This Endpoint does not support progressive replies for the fixture input');
  }
  const ordinary = vi.fn(lease.send);
  const stream = createCoreReplyStream({
    endpoint: { ...lease, send: ordinary }, streaming: { ...streaming, minIntervalMs: 0 },
    options: { source: request.source }, release() {},
    async deliver(content, execution) {
      const result = await execution.send({ conversation: request.conversation, payload: content });
      if (result.result === undefined) return { status: 'suppressed' };
      if (typeof result.result !== 'string') throw new Error('Expected one native stream message identity');
      const message = { conversation: request.conversation, id: result.result };
      execution.confirmed({ message }, result.contentUnavailable ? undefined : result.confirmedContent);
      return { status: 'sent', message };
    },
  });
  const snapshot = (text: string, revision: number, complete = false): ReplyStreamSnapshot => ({
    revision, messages: [{ key: 'answer', complete, segments: [
      ...(request.prefix ?? []).map((value, index) => ({ key: `prefix-${index}`, complete: true, value })),
      { key: 'body', complete, value: request.format === 'markdown'
        ? { type: 'markdown', data: { content: text } } : { type: 'text', data: { text } } },
    ] }],
  });
  return { stream, snapshot, ordinary };
}
