/**
 * Bridge AgentStream wire events ↔ HookRegistry subscriptions (ADR 0039 P0).
 */
import type { AIHookEvent, AIHookEventType } from '../orchestrator/types.js';
import { AgentStreamEventType, type AgentStreamEvent, type AgentStreamEventTypeName } from '@zhin.js/ai/agent-stream';

/** Legacy `type:action` hook keys → Eve-aligned stream event names. */
export const LEGACY_HOOK_STREAM_ALIASES: Readonly<Record<string, AgentStreamEventTypeName>> = {
  'message:received': AgentStreamEventType.MESSAGE_RECEIVED,
  'message:sent': AgentStreamEventType.MESSAGE_COMPLETED,
  'session:new': AgentStreamEventType.SESSION_STARTED,
  'tool:call': AgentStreamEventType.ACTIONS_REQUESTED,
  'tool:result': AgentStreamEventType.ACTION_RESULT,
};

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
