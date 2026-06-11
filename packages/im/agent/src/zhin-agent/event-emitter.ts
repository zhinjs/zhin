import type { Message, Plugin } from '@zhin.js/core';
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
    commMessage: Message,
    mode: Plugin.AIEventPayload['mode'],
    extra: Partial<Plugin.AIEventPayload> = {},
  ): Plugin.AIEventPayload {
    const { source = 'zhin-agent', ...rest } = extra;
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
