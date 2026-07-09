import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { Message } from '../orchestrator/types.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import { InboundTurnQueue } from './inbound-turn-queue.js';
import {
  normalizeInboundQueueConfig,
  shouldUseGroupFifoQueue,
  type ResolvedInboundQueueConfig,
} from './inbound-queue-config.js';
import type { ZhinAgentConfig } from '../config/index.js';

export function createInboundTurnQueue(
  config: Required<ZhinAgentConfig>,
  emitter: ZhinAgentEventEmitter,
): { config: ResolvedInboundQueueConfig; queue: InboundTurnQueue } {
  const inboundQueueConfig = normalizeInboundQueueConfig(config.inboundQueue);
  const queue = new InboundTurnQueue(inboundQueueConfig, {
    emitQueuedStart: (commMessage, sessionKey) => {
      emitter.emit(
        'ai.activity.queued.start',
        emitter.createPayload(sessionKey, commMessage, 'text'),
      );
    },
    emitQueuedClear: (commMessage, sessionKey) => {
      emitter.emit(
        'ai.activity.queued.clear',
        emitter.createPayload(sessionKey, commMessage, 'text'),
      );
    },
  });
  return { config: inboundQueueConfig, queue };
}

export async function runWithInboundQueue<T>(
  commMessage: Message,
  inboundQueueConfig: ResolvedInboundQueueConfig,
  queue: InboundTurnQueue,
  opts: {
    content?: string;
    coalesce?: boolean;
    run: (mergedContent: string) => Promise<T>;
  },
): Promise<T> {
  if (!shouldUseGroupFifoQueue(commMessage, inboundQueueConfig)) {
    return opts.run(opts.content ?? '');
  }
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  return queue.schedule({
    sessionKey,
    commMessage,
    content: opts.content,
    coalesce: opts.coalesce,
    run: opts.run,
  });
}
