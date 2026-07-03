/**
 * HookRegistry — AI lifecycle hooks with common/specialized support.
 *
 * Unified hook system (replaces legacy agent/hooks.ts module-level Map).
 *   - Integrated with Plugin lifecycle (auto-dispose)
 *   - common/specialized scoping
 *   - Error isolation per handler
 *   - PreToolUse/PostToolUse interception (allow/deny/modify/skip)
 */

import { Logger } from '@zhin.js/logger';
import { ResourceRegistry } from './resource-registry.js';
import type {
  ResourceScope,
  AIHook, AIHookEvent, AIHookEventType,
  PreToolUseHook, PostToolUseHook, PreToolUseEvent, PostToolUseEvent,
  ToolHookDecision, PostToolHookDecision,
} from './types.js';
import { emitAIHookBusEvent } from '../plugin-ai-hook-bus.js';

const logger = new Logger(null, 'HookRegistry');

export class HookRegistry extends ResourceRegistry<AIHook> {
  private readonly preToolUseHooks: PreToolUseHook[] = [];
  private readonly postToolUseHooks: PostToolUseHook[] = [];

  /**
   * Trigger all hooks matching the event.
   * Matches both broad type ('message') and specific key ('message:received').
   */
  async trigger(event: AIHookEvent, agentId?: string): Promise<void> {
    emitAIHookBusEvent(event, 'orchestrator-hook', agentId);

    const hooks = agentId ? this.getForAgent(agentId) : this.getAll();
    const matching = hooks.filter(h =>
      h.event === event.type || h.event === `${event.type}:${event.action}`,
    );

    for (const hook of matching) {
      try {
        await hook.handler(event);
      } catch (err: unknown) {
        // Swallow individual hook errors to not break the pipeline
      }
    }
  }

  getForEvent(event: string, agentId?: string): AIHook[] {
    const hooks = agentId ? this.getForAgent(agentId) : this.getAll();
    return hooks.filter(h => h.event === event || event.startsWith(h.event + ':'));
  }

  // ---------------------------------------------------------------------------
  // PreToolUse / PostToolUse interception hooks
  // ---------------------------------------------------------------------------

  addPreToolUseHook(hook: PreToolUseHook): () => void {
    this.preToolUseHooks.push(hook);
    this.preToolUseHooks.sort((a, b) => b.priority - a.priority);
    return () => {
      const idx = this.preToolUseHooks.indexOf(hook);
      if (idx !== -1) this.preToolUseHooks.splice(idx, 1);
    };
  }

  addPostToolUseHook(hook: PostToolUseHook): () => void {
    this.postToolUseHooks.push(hook);
    this.postToolUseHooks.sort((a, b) => b.priority - a.priority);
    return () => {
      const idx = this.postToolUseHooks.indexOf(hook);
      if (idx !== -1) this.postToolUseHooks.splice(idx, 1);
    };
  }

  /**
   * Run all PreToolUse hooks in priority order.
   * Returns the first non-skip decision; defaults to 'allow' if all skip.
   */
  async triggerPreToolUse(event: PreToolUseEvent): Promise<ToolHookDecision> {
    for (const hook of this.preToolUseHooks) {
      try {
        const result = await hook.handler(event);
        if (result.decision !== 'skip') return result;
      } catch (err: unknown) {
        logger.error(`PreToolUse hook "${hook.name}" error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { decision: 'allow' };
  }

  /**
   * Run all PostToolUse hooks in priority order.
   * Returns the first non-accept decision that modifies/rejects; defaults to 'accept'.
   */
  async triggerPostToolUse(event: PostToolUseEvent): Promise<PostToolHookDecision> {
    for (const hook of this.postToolUseHooks) {
      try {
        const result = await hook.handler(event);
        if (result.decision !== 'accept') return result;
      } catch (err: unknown) {
        logger.error(`PostToolUse hook "${hook.name}" error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { decision: 'accept' };
  }

  override dispose(): void {
    super.dispose();
    this.preToolUseHooks.length = 0;
    this.postToolUseHooks.length = 0;
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
