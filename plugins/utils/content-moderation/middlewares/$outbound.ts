import { defineMiddleware } from 'zhin.js/middleware';
import type { OutboundEnvelope } from '@zhin.js/core/runtime';
import {
  buildScanContext,
  extractFromOutboundPayload,
  getModerationEngine,
  resolveModerationConfig,
  shouldBypassOutbound,
  type ModerationConfig,
} from '../src/index.js';

/**
 * Outbound content moderation.
 * - redact uses envelope.replace()
 * - drop skips platform send (do not call next)
 */
export default defineMiddleware<OutboundEnvelope, ModerationConfig>({
  target: 'outbound',
  phase: 'before-dispatch',
  order: -100,
  async handle(context, next) {
    const config = resolveModerationConfig(context.config);
    if (shouldBypassOutbound(config)) {
      await next();
      return;
    }

    const envelope = context.input;
    // 引擎由 plugin setup 按 generation 配置一次；这里只做判定。
    const engine = getModerationEngine();

    const extracted = extractFromOutboundPayload(envelope.payload);
    if (!extracted.text && extracted.images.length === 0) {
      await next();
      return;
    }

    const scanInput = {
      text: extracted.text,
      images: extracted.images,
      direction: 'outbound' as const,
      context: buildScanContext({
        adapter: envelope.conversation.endpoint.adapter,
        endpoint: envelope.conversation.endpoint.id,
        conversationKind: envelope.conversation.kind,
        conversationId: envelope.conversation.id,
      }),
    };

    const result = await engine.apply({
      direction: 'outbound',
      extracted,
      scanInput,
      hooks: {
        getPayload: () => envelope.payload,
        replacePayload: (payload) => {
          envelope.replace(payload);
        },
      },
    });

    if (result.continue) {
      await next();
    }
  },
});
