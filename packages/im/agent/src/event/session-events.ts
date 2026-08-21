import type { Message } from '../resource-hub/types.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';

export function emitSessionNewEvent(
  emitter: ZhinAgentEventEmitter,
  sessionId: string,
  commMessage: Message,
  mode: 'text' | 'multimodal',
  content: string,
  reply: string,
): void {
  emitter.emit('ai.session.new', emitter.createPayload(sessionId, commMessage, mode, {
    reason: 'first_message',
    content,
    reply,
  }));
}

export interface SessionCompactInfo {
  microSavedTokens: number;
  autoSavedTokens: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
}

export function emitSessionCompactEvent(
  emitter: ZhinAgentEventEmitter,
  sessionId: string,
  commMessage: Message,
  mode: 'text' | 'multimodal',
  info: SessionCompactInfo,
): void {
  emitter.emit('ai.session.compact', emitter.createPayload(sessionId, commMessage, mode, {
    path: 'agent',
    compactedCount: 1,
    savedTokens: info.microSavedTokens + info.autoSavedTokens,
    totalTokensBefore: info.totalTokensBefore,
    totalTokensAfter: info.totalTokensAfter,
    result: info,
  }));
}
