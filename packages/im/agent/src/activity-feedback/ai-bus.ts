import type { AIEventPayload } from '../ai-event-subscriber.js';

type AIBusListener = (payload: AIEventPayload) => void;

/**
 * Module-level AI event bus for Plugin Runtime consumers that cannot use
 * Plugin ALS / `subscribeAIEvents(plugin, ...)`.
 *
 * `ZhinAgentEventEmitter.emit` fans out here so activity-feedback (and similar
 * Runtime plugins) can subscribe without a host Plugin.
 */
export class ActivityFeedbackAIBus {
  private readonly listeners = new Map<string, Set<AIBusListener>>();

  on(event: string, listener: AIBusListener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: AIBusListener): this {
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

  /** Test helper — clears all listeners. */
  clear(): void {
    this.listeners.clear();
  }
}

export const activityFeedbackAiBus = new ActivityFeedbackAIBus();
