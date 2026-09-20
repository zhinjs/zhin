import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AIEventPayload } from '../ai-event-contract.js';
import type { AIEventTarget } from '../ai-event-subscriber.js';

const logger = getLogger('AgentEventBus');

export type AIEventListener = (payload: AIEventPayload) => void | Promise<void>;

/** Generation-owned publication boundary for Agent lifecycle events. */
export class AgentEventBus implements AIEventTarget {
  readonly #listeners = new Map<string, Set<AIEventListener>>();

  on(event: string, listener: AIEventListener): this {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: AIEventListener): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload: AIEventPayload): void {
    void this.dispatch(event, payload);
  }

  async dispatch(event: string, payload: AIEventPayload): Promise<void> {
    const listeners = this.#listeners.get(event);
    if (!listeners?.size) {
      logger.debug(formatCompact({ op: 'agent_event_no_listener', event }));
      return;
    }
    // Capture generation admission at publication time. A retiring listener and
    // its replacement must never observe the same in-flight event.
    const snapshot = [...listeners];
    const pending = snapshot.map((listener) => {
      try {
        return Promise.resolve(listener(payload)).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    });
    await Promise.all(pending);
  }

  clear(): void {
    this.#listeners.clear();
  }
}
