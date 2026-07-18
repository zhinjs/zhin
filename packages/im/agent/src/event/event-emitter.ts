import type { Message, Plugin } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { EventSystem } from './event-system.js';
import type { EventHandler } from './contracts.js';
import { getScheduleTurnContext, getActivityFeedbackEligible } from '../internal/turn-context.js';
import { activityFeedbackAiBus } from '../activity-feedback/ai-bus.js';

const logger = getLogger('ZhinAgent');

export class ZhinAgentEventEmitter {
  private readonly eventSystem: EventSystem;

  constructor(private hostPlugin: Plugin | null = null) {
    this.eventSystem = new EventSystem({ source: 'zhin-agent' });
  }

  /** Agent turn 域事件订阅（EventSystem）；plugin lifecycle 仍走 dispatch/emit。 */
  on(eventType: string, handler: EventHandler): () => void {
    return this.eventSystem.on(eventType, handler);
  }

  getEventSystem(): EventSystem {
    return this.eventSystem;
  }

  setHostPlugin(plugin: Plugin): void {
    this.hostPlugin = plugin.root ?? plugin;
  }

  getHostPlugin(): Plugin | null {
    return this.hostPlugin;
  }

  createPayload(
    sessionId: string,
    commMessage: Message,
    mode: Plugin.AIEventPayload['mode'],
    extra: Partial<Plugin.AIEventPayload> = {},
  ): Plugin.AIEventPayload {
    const { source = 'zhin-agent', hookContext: extraHookContext, ...rest } = extra;
    const scheduleCtx = getScheduleTurnContext();
    const hookContext: Record<string, unknown> = {
      ...(extraHookContext && typeof extraHookContext === 'object' ? extraHookContext : {}),
    };
    if (scheduleCtx?.createdBy) hookContext.scheduleCreatedBy = scheduleCtx.createdBy;
    if (scheduleCtx?.jobId) hookContext.scheduleJobId = scheduleCtx.jobId;
    if (scheduleCtx?.preview === true) hookContext.schedulePreview = true;
    if (scheduleCtx?.activityFeedback === true) hookContext.scheduleActivityFeedback = true;
    if (scheduleCtx?.executionPlan) hookContext.scheduleExecutionPlan = scheduleCtx.executionPlan;
    if (getActivityFeedbackEligible()) hookContext.activityFeedbackEligible = true;
    return {
      sessionId,
      source,
      mode,
      userId: commMessage.$sender.id,
      platform: String(commMessage.$adapter),
      endpointId: commMessage.$endpoint,
      sceneId: commMessage.$channel?.id ?? commMessage.$sender.id,
      messageId: commMessage.$id,
      scope: commMessage.$channel?.type ?? 'private',
      ...(Object.keys(hookContext).length > 0 ? { hookContext } : {}),
      ...rest,
    };
  }

  async dispatch(
    name: keyof Plugin.Lifecycle,
    payload: Plugin.AIEventPayload,
  ): Promise<void> {
    // Always fan-out for Plugin Runtime subscribers (activity-feedback, etc.).
    // Legacy Feature path still receives the same event via root.dispatch below.
    activityFeedbackAiBus.emit(String(name), payload);
    const root = this.hostPlugin?.root ?? this.hostPlugin;
    if (!root) return;
    await root.dispatch(name as any, payload);
  }

  emit(name: keyof Plugin.Lifecycle, payload: Plugin.AIEventPayload): void {
    this.eventSystem.emitFireAndForget(String(name), payload);
    // Fan-out happens inside dispatch (avoid double-emit on the module bus).
    this.dispatch(name, payload).catch((error) => {
      logger.warn(formatCompact({
        ai_event: String(name),
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}
