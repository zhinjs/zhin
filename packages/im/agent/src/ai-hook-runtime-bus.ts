import type { AIEventPayload } from './ai-event-bus.js';

type AIHookBusListener = (payload: AIEventPayload) => void;

/**
 * Module-level AI hook bus for Plugin Runtime consumers that cannot use
 * Plugin ALS / `onAIHook(plugin, …)`.
 *
 * `emitAIHookBusEvent` fans out here so Runtime plugins can observe hooks
 * without a host Plugin (same pattern as `activityFeedbackAiBus`).
 */
export class AIHookRuntimeBus {
  private readonly listeners = new Map<string, Set<AIHookBusListener>>();

  on(event: string, listener: AIHookBusListener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: AIHookBusListener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload: AIEventPayload): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Listener errors must not break the Agent emit path.
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const aiHookRuntimeBus = new AIHookRuntimeBus();
