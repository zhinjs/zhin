import { defineMiddleware, type MiddlewareContext } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { aiCompletionToken, createDeliveryTarget, databaseHostToken, getLogger, hasResource,
  outboundHostToken, usageSubjectFromMessage } from 'zhin.js';
import { adapterFeatureId, type AdapterIndex } from 'zhin.js/adapter';
import {
  buildScanContext,
  extractFromTextAndSegments,
  resolveModerationConfig,
  shouldBypassInbound,
  type ModerationConfig,
} from '../../src/index.js';
import { moderationEngineToken } from '../../src/runtime.js';

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

    const bypass = shouldBypassInbound(config, {
      sender,
      conversationId,
      endpointMasters,
    });
    const modelOwnsRecall = await runGroupModeration(context, config, bypass);
    if (bypass) {
      await next();
      return;
    }

    // 引擎由 plugin setup 按 generation 配置一次（configure 含 provider 重建与
    // 词库 readFileSync，不能留在每条消息的热路径）；这里只做判定。
    const engine = context.use(moderationEngineToken);

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
      recallManaged: modelOwnsRecall,
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

async function runGroupModeration(
  context: MiddlewareContext<Message, ModerationConfig, string | undefined>,
  config: ModerationConfig, bypass: boolean,
): Promise<boolean> {
  const message = context.input;
  const conversation = message.conversation;
  const target = config.groupModeration.find((item) => conversation.kind === 'group'
    && item.adapter === conversation.endpoint.adapter
    && item.endpoint === message.endpointId && item.group === conversation.id);
  if (!target) return false;
  let modelOwnsRecall = false;
  const logger = getLogger('content-moderation');
  try {
    const endpoint = context.project<AdapterIndex>(adapterFeatureId)
      .connection(conversation.endpoint.adapter, conversation.endpoint.id);
    // Reject alias fallback and account switches, even when a local instance name is reused.
    if (!endpoint || endpoint.identity.id !== conversation.endpoint.id
      || endpoint.identity.adapter !== target.adapter || endpoint.selfUserId !== target.account) return false;
    const moderator = context.use(moderationEngineToken).groupModerator;
    const { text } = extractFromTextAndSegments(message.content, message.segments);
    const scope = JSON.stringify(conversation);
    try {
      if (!bypass && message.sender?.id && message.origin !== 'self'
        && hasResource(context, aiCompletionToken) && hasResource(context, databaseHostToken)) {
        await moderator.review({
          scope, group: conversation.id, sender: message.sender.id,
          messageId: message.id ?? '', sentAt: Number(message.metadata?.platformSentAt), text,
          signal: context.signal,
          state: context.use(databaseHostToken).state.forConversation(createDeliveryTarget({ conversation })),
          completion: context.use(aiCompletionToken), management: endpoint.management ?? {},
          onBehalfOf: usageSubjectFromMessage(message),
          onReview: () => { modelOwnsRecall = true; },
          reply: async (content, mention) => {
            context.signal.throwIfAborted();
            const receipt = await message.$reply(mention ? [
              { type: 'mention', data: { target: mention } },
              { type: 'text', data: { text: ` ${content}` } },
            ] : content);
            if (receipt.status !== 'sent') throw new Error('Moderation notice was not delivered');
          },
          recall: async () => {
            context.signal.throwIfAborted();
            const host = context.use(outboundHostToken);
            if (!host.recall || !message.id) throw new Error('Original message cannot be recalled');
            await host.recall({ adapter: target.adapter, endpointKey: conversation.endpoint.id,
              message: { conversation, id: message.id } });
          },
          audit: (event) => logger.info({ ...event, endpoint: conversation.endpoint.id, group: conversation.id }),
        });
      }
    } finally {
      moderator.remember(scope, message.sender?.id ?? '', text);
    }
  } catch (error) {
    logger.warn('Automatic group moderation unavailable', error instanceof Error ? error.message : String(error));
  }
  return modelOwnsRecall;
}

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
