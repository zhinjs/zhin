/**
 * Bridge AgentStream wire events ↔ HookRegistry subscriptions (ADR 0039 P0).
 */
import type { AIHookEvent, AIHookEventType } from '../resource-hub/types.js';
import { AgentStreamEventType, type AgentStreamEvent, type AgentStreamEventTypeName } from '@zhin.js/ai/agent-stream';

export function isAgentStreamHookEventName(event: string): event is AgentStreamEventTypeName {
  return (Object.values(AgentStreamEventType) as string[]).includes(event);
}

export function agentStreamEventToAIHookEvent(
  streamEvent: AgentStreamEvent,
  sessionId?: string,
): AIHookEvent {
  const [type, action] = streamEvent.type.split('.', 2);
  const resolvedSessionId =
    typeof streamEvent.data?.sessionId === 'string' ? streamEvent.data.sessionId : sessionId;
  return {
    type: type as AIHookEventType,
    action: action ?? streamEvent.type,
    sessionId: resolvedSessionId,
    context: {
      ...(streamEvent.data ?? {}),
      streamType: streamEvent.type,
    },
    timestamp: new Date(streamEvent.timestamp ?? Date.now()),
    messages: [],
  };
}
