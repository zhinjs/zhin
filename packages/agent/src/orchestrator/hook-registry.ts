/**
 * HookRegistry — AI lifecycle hooks with common/specialized support.
 *
 * Absorbs and replaces: agent/hooks.ts (module-level Map)
 * Improvements:
 *   - Integrated with Plugin lifecycle (auto-dispose)
 *   - common/specialized scoping
 *   - Error isolation per handler
 */

import { ResourceRegistry } from './resource-registry.js';
import type { ResourceScope, AIHook, AIHookEvent, AIHookEventType } from './types.js';

export class HookRegistry extends ResourceRegistry<AIHook> {
  /**
   * Trigger all hooks matching the event.
   * Matches both broad type ('message') and specific key ('message:received').
   */
  async trigger(event: AIHookEvent, agentId?: string): Promise<void> {
    const hooks = agentId ? this.getForAgent(agentId) : this.getAll();
    const matching = hooks.filter(h =>
      h.event === event.type || h.event === `${event.type}:${event.action}`,
    );

    for (const hook of matching) {
      try {
        await hook.handler(event);
      } catch (err: any) {
        // Swallow individual hook errors to not break the pipeline
      }
    }
  }

  getForEvent(event: string, agentId?: string): AIHook[] {
    const hooks = agentId ? this.getForAgent(agentId) : this.getAll();
    return hooks.filter(h => h.event === event || event.startsWith(h.event + ':'));
  }
}

export function createAIHookEvent(
  type: AIHookEventType,
  action: string,
  sessionId?: string,
  context: Record<string, unknown> = {},
): AIHookEvent {
  return { type, action, sessionId, context, timestamp: new Date(), messages: [] };
}
