/**
 * Publish AgentStreamEvent via per-orchestrator bus.
 */
import type { AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { AgentStreamPublishContext } from './agent-stream-bus.js';
import { mapTurnEventToAgentStreamEvents, type TurnToStreamContext } from './turn-to-agent-stream.js';
import type { TurnEvent } from './turn-event.js';

export function publishAgentStream(
  host: Pick<ZhinAgentPrivate, 'orchestrator'>,
  event: AgentStreamEvent,
  ctx: AgentStreamPublishContext = {},
): void {
  const bus = host.orchestrator?.agentStreamBus;
  if (!bus) return;
  void bus.publish(event, ctx);
}

export function publishTurnStreamEvents(
  host: Pick<ZhinAgentPrivate, 'orchestrator'>,
  turnEvent: TurnEvent,
  ctx: TurnToStreamContext & AgentStreamPublishContext,
): void {
  const { sessionId, turnId, httpSessionId, agentId } = ctx;
  for (const streamEvent of mapTurnEventToAgentStreamEvents(turnEvent, { sessionId, turnId })) {
    publishAgentStream(host, streamEvent, { sessionId, turnId, httpSessionId, agentId });
  }
}
