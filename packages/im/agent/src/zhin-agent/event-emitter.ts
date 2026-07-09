import type { Message, Plugin } from '@zhin.js/core';
import { Logger, formatCompact } from '@zhin.js/logger';
import { getScheduleTurnContext } from './turn-context.js';

const logger = new Logger(null, 'ZhinAgent');

export class ZhinAgentEventEmitter {
  constructor(private hostPlugin: Plugin | null = null) {}

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
    const root = this.hostPlugin?.root ?? this.hostPlugin;
    if (!root) return;
    await root.dispatch(name as any, payload);
  }

  emit(name: keyof Plugin.Lifecycle, payload: Plugin.AIEventPayload): void {
    this.dispatch(name, payload).catch((error) => {
      logger.warn(formatCompact({
        ai_event: String(name),
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}
