/**
 * Publish AgentStreamEvent via the generation-owned Agent Resource Hub bus.
 */
import { AgentRunJournal, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { AgentStreamPublishContext } from './agent-stream-bus.js';
import { mapTurnEventToAgentStreamEvents, type TurnToStreamContext } from './turn-to-agent-stream.js';
import type { TurnEvent } from './turn-event.js';

export function publishAgentStream(
  host: Pick<ZhinAgentPrivate, 'resourceHub'>,
  event: AgentStreamEvent,
  ctx: AgentStreamPublishContext = {},
): void {
  const bus = host.resourceHub?.agentStreamBus;
  if (!bus) return;
  void bus.publish(event, ctx);
}

export function publishTurnStreamEvents(
  host: Pick<ZhinAgentPrivate, 'resourceHub'>,
  turnEvent: TurnEvent,
  ctx: TurnToStreamContext & AgentStreamPublishContext,
  journal: AgentRunJournal,
): void {
  const { sessionId, turnId, agentId } = ctx;
  for (const streamEvent of mapTurnEventToAgentStreamEvents(turnEvent, { sessionId, turnId, journal })) {
    publishAgentStream(host, streamEvent, { sessionId, turnId, agentId });
  }
}
