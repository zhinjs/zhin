import { getHostRootPlugin, type Plugin } from '@zhin.js/core';
import type { AIHookEvent } from './orchestrator/types.js';
import { createAIHookBusPayload } from './ai-event-bus.js';

function resolveRootPlugin(): Plugin | null {
  return getHostRootPlugin();
}

export function emitAIHookBusEvent(
  event: AIHookEvent,
  source: Plugin.AIEventPayload['source'],
  agentId?: string,
): void {
  const root = resolveRootPlugin();
  if (!root || typeof root.dispatch !== 'function') return;
  const payload = createAIHookBusPayload(event, source, agentId);
  root.dispatch('ai.hook', payload);

  if (event.type === 'session' && event.action === 'new') {
    root.dispatch('ai.session.new', payload);
  }
  if (event.type === 'session' && event.action === 'compact') {
    root.dispatch('ai.session.compact', payload);
  }
}