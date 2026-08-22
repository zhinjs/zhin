import type { Plugin } from '@zhin.js/core';
import type { AIHookEvent } from './resource-hub/types.js';
import { createAIHookBusPayload } from './ai-event-bus.js';
import { aiHookRuntimeBus } from './ai-hook-runtime-bus.js';
import { runModuleAIHookHandlers } from './ai-hook-handlers.js';

/**
 * Emit AI hook / session lifecycle events onto:
 * 1. Module Runtime bus (`aiHookRuntimeBus`) — Plugin Runtime path
 * 2. Legacy `registerAIHook` handlers (module-level)
 */
export function emitAIHookBusEvent(
  event: AIHookEvent,
  source: Plugin.AIEventPayload['source'],
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

  void runModuleAIHookHandlers(event);
}