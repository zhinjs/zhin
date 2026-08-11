import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIEventPayload } from '../ai-event-subscriber.js';

const logger = getLogger('AIBus');

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
    if (!set || set.size === 0) {
      // 零订阅 = activity-feedback 插件未加载，或运行时装了双份 @zhin.js/agent
      // （模块级 bus 分裂）。此前完全静默，是 typing 反馈消失最难排查的形态。
      logger.debug(formatCompact({ op: 'ai_bus_no_listener', event }));
      return;
    }
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
