import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { outboundHostToken } from '@zhin.js/plugin-runtime';
import {
  buildScanContext,
  extractFromTextAndSegments,
  getModerationEngine,
  resolveModerationConfig,
  shouldBypassInbound,
  type ModerationConfig,
} from '../src/index.js';

/**
 * Inbound content moderation.
 * - order -100: run early before commands / other middleware
 * - inbound redact：无法改写只读 Message，仍 next() 放行
 */
export default defineMiddleware<Message, ModerationConfig>({
  target: 'inbound',
  phase: 'before-dispatch',
  order: -100,
  async handle(context, next) {
    const config = resolveModerationConfig(context.config);
    if (!config.enabled || !config.inbound.enabled) {
      await next();
      return;
    }

    const message = context.input;
    const sender = message.sender?.id;
    const conversationId = message.conversation.id;
    const endpointMasters = resolveEndpointMasters(message, config);

    if (shouldBypassInbound(config, {
      sender,
      conversationId,
      endpointMasters,
    })) {
      await next();
      return;
    }

    // 引擎由 plugin setup 按 generation 配置一次（configure 含 provider 重建与
    // 词库 readFileSync，不能留在每条消息的热路径）；这里只做判定。
    const engine = getModerationEngine();

    const extracted = extractFromTextAndSegments(message.content, message.segments);
    if (!extracted.text && extracted.images.length === 0) {
      await next();
      return;
    }

    const scanInput = {
      text: extracted.text,
      images: extracted.images,
      direction: 'inbound' as const,
      context: buildScanContext({
        adapter: message.conversation.endpoint.adapter,
        endpoint: message.conversation.endpoint.id,
        conversationKind: message.conversation.kind,
        conversationId,
        sender,
      }),
    };

    const result = await engine.apply({
      direction: 'inbound',
      extracted,
      scanInput,
      hooks: {
        reply: async (content) => {
          await message.$reply(content);
        },
        recall: async () => {
          const messageId = message.id;
          if (!messageId) return false;
          try {
            const host = context.use(outboundHostToken);
            if (!host.recall) return false;
            const conv = message.conversation;
            await host.recall({
              adapter: conv.endpoint.adapter,
              endpointKey: conv.endpoint.id,
              message: {
                conversation: {
                  kind: conv.kind,
                  id: conv.id,
                  endpoint: conv.endpoint,
                },
                id: messageId,
              },
            });
            return true;
          } catch {
            return false;
          }
        },
      },
    });

    if (result.continue) {
      await next();
    }
  },
});

/**
 * Masters from plugin config + optional metadata.endpointMaster / metadata.master.
 */
function resolveEndpointMasters(
  message: Message,
  config: ModerationConfig,
): readonly string[] {
  const out: string[] = [...config.masters];
  const meta = message.metadata ?? {};
  for (const key of ['master', 'endpointMaster', 'owner'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  }
  return Object.freeze(out);
}
