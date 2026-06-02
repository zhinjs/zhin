import type { Plugin, ToolContext } from '@zhin.js/core';
import { Logger, formatCompact } from '@zhin.js/logger';

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
    context: ToolContext,
    mode: Plugin.AIEventPayload['mode'],
    extra: Partial<Plugin.AIEventPayload> = {},
  ): Plugin.AIEventPayload {
    return {
      sessionId,
      source: 'zhin-agent',
      mode,
      userId: context.senderId,
      platform: context.platform,
      botId: context.botId,
      sceneId: context.sceneId,
      messageId: context.messageId,
      scope: context.scope,
      ...extra,
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