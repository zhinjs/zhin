/**
 * Register middleware that records messages to the context manager.
 */
import { getPlugin, Message } from '@zhin.js/core';
import type { MessageRecord } from '../context-manager.js';
import type { AIServiceRefs } from './shared-refs.js';

export function registerMessageRecorder(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { root } = plugin;

  root.addMiddleware(async (message: Message, next: () => Promise<void>) => {
    await next();
    if (refs.aiService?.contextManager) {
      const record: MessageRecord = {
        platform: message.$adapter,
        scene_id: message.$channel?.id || message.$sender.id,
        scene_type: message.$channel?.type || 'private',
        scene_name: (message.$channel as any)?.name || '',
        sender_id: message.$sender.id,
        sender_name: message.$sender.name || message.$sender.id,
        message:
          typeof message.$raw === 'string'
            ? message.$raw
            : JSON.stringify(message.$raw),
        time: message.$timestamp || Date.now(),
      };
      refs.aiService.contextManager.recordMessage(record).catch(() => {});
    }
  });
}
