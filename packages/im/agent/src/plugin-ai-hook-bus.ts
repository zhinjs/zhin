import { getHostRootPlugin, type Plugin } from '@zhin.js/core';
import type { AIHookEvent } from './orchestrator/types.js';
import { createAIHookBusPayload } from './ai-event-bus.js';
import { aiHookRuntimeBus } from './ai-hook-runtime-bus.js';
import { runModuleAIHookHandlers } from './ai-hook-handlers.js';

function resolveRootPlugin(): Plugin | null {
  return getHostRootPlugin();
}

/**
 * Emit AI hook / session lifecycle events onto:
 * 1. Module Runtime bus (`aiHookRuntimeBus`) — Plugin Runtime without host Plugin
 * 2. Legacy `registerAIHook` handlers
 * 3. Root Plugin event bus when a classic host Plugin exists (`onAIHook` / `plugin.on`)
 *
 * HookRegistry and AgentStreamBus remain internal orchestration.
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

  // Fire-and-forget: registerAIHook handlers must not block the turn pipeline.
  void runModuleAIHookHandlers(event);

  const root = resolveRootPlugin();
  if (!root || typeof root.dispatch !== 'function') return;
  root.dispatch('ai.hook', payload);

  if (event.type === 'session' && event.action === 'new') {
    root.dispatch('ai.session.new', payload);
  }
  if (event.type === 'session' && event.action === 'compact') {
    root.dispatch('ai.session.compact', payload);
  }
}