import type { AIHookEvent } from './resource-hub/types.js';
import { createAIHookBusPayload, type AIEventPayload } from './ai-event-bus.js';
import { aiHookRuntimeBus } from './ai-hook-runtime-bus.js';

/** Emit AI hook and session lifecycle events onto the Runtime bus. */
export function emitAIHookBusEvent(
  event: AIHookEvent,
  source: AIEventPayload['source'],
  agentId?: string,
): void {
  const payload = createAIHookBusPayload(event, source, agentId);
  aiHookRuntimeBus.emit('ai.hook', payload);
  if (event.type === 'session' && event.action === 'new') {
    aiHookRuntimeBus.emit('ai.session.new', payload);
  }
  if (event.type === 'session' && event.action === 'compact') {
    aiHookRuntimeBus.emit('ai.session.compact', payload);
  }
}
