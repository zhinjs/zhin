/**
 * HookRegistry adapter — AgentStreamBus sink (ADR 0041).
 */
import type { AgentStreamSink } from './agent-stream-bus.js';
import type { HookRegistry } from '../orchestrator/hook-registry.js';

export function createHookStreamSink(hooks: HookRegistry): AgentStreamSink {
  return {
    name: 'hook',
    async handle(event, ctx) {
      await hooks.triggerStream(event, ctx.agentId, ctx.sessionId, { skipBus: true, fromBus: true });
    },
  };
}
