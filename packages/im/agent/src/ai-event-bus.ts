import { type Message, commMessageFromHookContext, resolveIMSessionId, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { AIHookEvent } from './resource-hub/types.js';
import type { AIEventPayload } from './ai-event-contract.js';

export interface AISessionNewPayload extends AIEventPayload {
  reason: 'first_message';
}

export interface AISessionCompactPayload extends AIEventPayload {
  compactedCount: number;
  savedTokens: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
}

function resolveCommMessage(event: AIHookEvent): Message<any> | undefined {
  return commMessageFromHookContext(event.context);
}

function resolveSessionId(event: AIHookEvent): string {
  if (event.sessionId) return event.sessionId;
  const commMessage = resolveCommMessage(event);
  if (commMessage) {
    return resolveIMSessionIdFromMessage(commMessage);
  }
  return resolveIMSessionId({
    platform: 'system',
    endpointKey: 'default',
    kind: 'private',
    sceneId: 'unknown',
  });
}

export function createAIHookBusPayload(
  event: AIHookEvent,
  source: AIEventPayload['source'],
  agentId?: string,
): AIEventPayload {
  const commMessage = resolveCommMessage(event);
  return {
    sessionId: resolveSessionId(event),
    source,
    hookType: event.type,
    hookAction: event.action,
    hookContext: event.context,
    messages: event.messages,
    agentId,
    platform: commMessage
      ? String(commMessage.clientAdapter ?? commMessage.conversation.endpoint.adapter)
      : undefined,
    endpointKey: commMessage?.endpointId ?? commMessage?.conversation.endpoint.id,
    userId: commMessage?.sender?.id,
    sceneId: commMessage?.conversation.id,
    messageId: typeof event.context.messageId === 'string' ? event.context.messageId : commMessage?.id,
    content: typeof event.context.content === 'string' ? event.context.content : undefined,
    toolName: typeof event.context.toolName === 'string' ? event.context.toolName : undefined,
    args: typeof event.context.args === 'object' && event.context.args !== null
      ? event.context.args as Record<string, unknown>
      : undefined,
    result: event.context.result,
    error: typeof event.context.error === 'string' ? event.context.error : undefined,
    reply: event.messages[0],
    compactedCount: typeof event.context.compactedCount === 'number' ? event.context.compactedCount : undefined,
    savedTokens: typeof event.context.savedTokens === 'number' ? event.context.savedTokens : undefined,
    totalTokensBefore: typeof event.context.totalTokensBefore === 'number' ? event.context.totalTokensBefore : undefined,
    totalTokensAfter: typeof event.context.totalTokensAfter === 'number' ? event.context.totalTokensAfter : undefined,
  };
}

export function isAISessionNewPayload(payload: AIEventPayload): payload is AISessionNewPayload {
  return payload.reason === 'first_message';
}

export function isAISessionCompactPayload(payload: AIEventPayload): payload is AISessionCompactPayload {
  return typeof payload.compactedCount === 'number'
    && typeof payload.savedTokens === 'number'
    && typeof payload.totalTokensBefore === 'number'
    && typeof payload.totalTokensAfter === 'number';
}
