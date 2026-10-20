import type { Message } from '@zhin.js/core';
import { getActivityFeedbackEligible } from '../internal/turn-context.js';
import type { AIEventName, AIEventPayload } from '../ai-event-contract.js';
import { AgentEventBus } from './ai-event-bus.js';

export class ZhinAgentEventEmitter {
  constructor(readonly events: AgentEventBus = new AgentEventBus()) {}

  createPayload(
    sessionId: string,
    commMessage: Message,
    mode: AIEventPayload['mode'],
    extra: Partial<AIEventPayload> = {},
  ): AIEventPayload {
    const { source = 'zhin-agent', hookContext: extraHookContext, ...rest } = extra;
    const hookContext: Record<string, unknown> = {
      ...(extraHookContext && typeof extraHookContext === 'object' ? extraHookContext : {}),
    };
    if (getActivityFeedbackEligible()) hookContext.activityFeedbackEligible = true;
    return {
      sessionId,
      source,
      mode,
      userId: commMessage.sender?.id,
      platform: String(commMessage.clientAdapter ?? commMessage.conversation.endpoint.adapter),
      endpointKey: commMessage.endpointId ?? commMessage.conversation.endpoint.id,
      sceneId: commMessage.conversation.id,
      messageId: commMessage.id,
      scope: commMessage.conversation.kind ?? 'private',
      ...(Object.keys(hookContext).length > 0 ? { hookContext } : {}),
      ...rest,
    };
  }

  async dispatch(
    name: AIEventName,
    payload: AIEventPayload,
  ): Promise<void> {
    // Runtime subscribers use the explicit Agent event bus.
    await this.events.dispatch(String(name), payload);
  }

  emit(name: AIEventName, payload: AIEventPayload): void {
    this.events.emit(String(name), payload);
  }
}
