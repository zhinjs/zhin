import type { Message, Plugin } from '@zhin.js/core';
import { commMessageFromHookContext } from '@zhin.js/core';
import { resolveIMSessionId, resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import type { AIHookEvent } from './orchestrator/types.js';

export type AIEventPayload = Plugin.AIEventPayload;

export interface AISessionNewPayload extends Plugin.AIEventPayload {
  reason: 'first_message';
}

export interface AISessionCompactPayload extends Plugin.AIEventPayload {
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
    endpointId: 'default',
    scope: 'private',
    sceneId: 'unknown',
  });
}

export function createAIHookBusPayload(
  event: AIHookEvent,
  source: Plugin.AIEventPayload['source'],
  agentId?: string,
): Plugin.AIEventPayload {
  const commMessage = resolveCommMessage(event);
  return {
    sessionId: resolveSessionId(event),
    source,
    hookType: event.type,
    hookAction: event.action,
    hookContext: event.context,
    messages: event.messages,
    agentId,
    platform: commMessage?.$adapter != null ? String(commMessage.$adapter) : undefined,
    endpointId: commMessage?.$endpoint,
    userId: commMessage?.$sender?.id,
    sceneId: commMessage?.$channel?.id,
    messageId: typeof event.context.messageId === 'string' ? event.context.messageId : commMessage?.$id,
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

export function isAISessionNewPayload(payload: Plugin.AIEventPayload): payload is AISessionNewPayload {
  return payload.reason === 'first_message';
}

export function isAISessionCompactPayload(payload: Plugin.AIEventPayload): payload is AISessionCompactPayload {
  return typeof payload.compactedCount === 'number'
    && typeof payload.savedTokens === 'number'
    && typeof payload.totalTokensBefore === 'number'
    && typeof payload.totalTokensAfter === 'number';
}

function onAIEvent(
  plugin: Plugin,
  event: 'ai.hook' | 'ai.session.new' | 'ai.session.compact',
  listener: (payload: Plugin.AIEventPayload) => void,
): () => void {
  plugin.on(event, listener);
  return () => plugin.off(event, listener);
}

export function onAIHook(plugin: Plugin, listener: (payload: Plugin.AIEventPayload) => void): () => void {
  return onAIEvent(plugin, 'ai.hook', listener);
}

export function onAISessionNew(plugin: Plugin, listener: (payload: AISessionNewPayload) => void): () => void {
  return onAIEvent(plugin, 'ai.session.new', listener as (payload: Plugin.AIEventPayload) => void);
}

export function onAISessionCompact(plugin: Plugin, listener: (payload: AISessionCompactPayload) => void): () => void {
  return onAIEvent(plugin, 'ai.session.compact', listener as (payload: Plugin.AIEventPayload) => void);
}
