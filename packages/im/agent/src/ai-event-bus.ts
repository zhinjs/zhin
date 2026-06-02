import type { Plugin } from '@zhin.js/core';
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

function resolveSessionId(event: AIHookEvent): string {
  if (event.sessionId) return event.sessionId;
  const platform = typeof event.context.platform === 'string' ? event.context.platform : 'system';
  const sceneId = typeof event.context.sceneId === 'string'
    ? event.context.sceneId
    : typeof event.context.channelId === 'string'
      ? event.context.channelId
      : `${event.type}:${event.action}`;
  const userId = typeof event.context.senderId === 'string'
    ? event.context.senderId
    : typeof event.context.from === 'string'
      ? event.context.from
      : 'system';
  return `${platform}:${sceneId}:${userId}`;
}

export function createAIHookBusPayload(
  event: AIHookEvent,
  source: Plugin.AIEventPayload['source'],
  agentId?: string,
): Plugin.AIEventPayload {
  return {
    sessionId: resolveSessionId(event),
    source,
    hookType: event.type,
    hookAction: event.action,
    hookContext: event.context,
    messages: event.messages,
    agentId,
    platform: typeof event.context.platform === 'string' ? event.context.platform : undefined,
    botId: typeof event.context.botId === 'string' ? event.context.botId : undefined,
    userId: typeof event.context.senderId === 'string'
      ? event.context.senderId
      : typeof event.context.from === 'string'
        ? event.context.from
        : undefined,
    sceneId: typeof event.context.sceneId === 'string'
      ? event.context.sceneId
      : typeof event.context.channelId === 'string'
        ? event.context.channelId
        : undefined,
    messageId: typeof event.context.messageId === 'string' ? event.context.messageId : undefined,
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