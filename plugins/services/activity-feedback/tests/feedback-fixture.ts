import { activityFeedbackSource, type AIEventPayload, type ActivityFeedbackSource } from '@zhin.js/agent';
import type { OutboundHost, CapturedOutboundOperation } from 'zhin.js/plugin-runtime';
import { plainTextFromSendContent } from '../../../../packages/game-kit/src/send-content-text.js';

/** Explicit test operation hook; production events use Core's captured RuntimeMessage. */
export function withOperation<T extends { conversation: ActivityFeedbackSource['target'] }>(message: T): T {
  const client = {}, signal = new AbortController().signal;
  Object.defineProperty(message, Symbol.for('zhin.operation-session/1'), { value: () => ({
    scene: message.conversation, endpoint: client, signal,
  }) });
  return message;
}

/** Test-only transport bridge; keeps the existing outbound spies while exercising captured flat IO. */
export function withCapturedOutbound(host: OutboundHost): OutboundHost {
  return { ...host, captureOperation(source): CapturedOutboundOperation {
    const operations = host.capabilities?.({ adapter: source.target.endpoint.adapter, endpointKey: source.target.endpoint.id })?.operations ?? [];
    const message = source.target;
    return { target: source.target, signal: source.signal ?? new AbortController().signal, release() {},
      send: (content, options) => host.send({ adapter: message.endpoint.adapter, endpointKey: message.endpoint.id,
        conversation: { kind: message.kind, id: message.id, ...(message.parent ? { parent: message.parent } : {}),
          ...(message.threadId ? { threadId: message.threadId } : {}) },
        content: plainTextFromSendContent(content as never), locale: options?.locale }),
      ...(operations.includes('recall') && host.recall ? { recall: ref => host.recall!({ message: ref }) } : {}),
      ...(operations.includes('edit') && host.edit ? { edit: (ref, content) => host.edit!({ message: ref, content }) } : {}),
      ...(operations.includes('reaction') && host.addReaction && host.removeReaction ? {
        addReaction: (ref, emoji, hint) => host.addReaction!({ message: ref, emoji, ...hint }),
        removeReaction: (ref, reactionId) => host.removeReaction!({ message: ref, reactionId }),
      } : {}),
      ...(operations.includes('typing') && host.typing ? { typing: (conversation, active) => host.typing!({ conversation, active }) } : {}),
    };
  } };
}

export function sourcePayload<T extends AIEventPayload>(payload: T): T {
  Object.defineProperty(payload, activityFeedbackSource, { value: {
    target: { endpoint: { adapter: payload.platform!, id: payload.endpointKey! }, kind: payload.scope as 'private' | 'group' | 'channel', id: payload.sceneId! },
    client: {}, signal: new AbortController().signal,
  }, enumerable: false });
  return payload;
}
