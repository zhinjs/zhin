import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  type RepeaterConfig,
} from '../../src/engine.js';
import { repeaterConfigToken, repeaterEngineToken } from '../../src/runtime.js';

/**
 * Runtime `Message` 是 conversation 原生：`conversation.kind/id` 直接喂给引擎
 * （引擎契约 `RepeaterInboundFields.conversation`，私聊由引擎判 null 跳过）。
 * Sender 为 MessageSenderRef（`{ id, name?, roles? }`），引擎只读 `id`。
 * Reply uses `Message.$reply` (available during inbound middleware scope).
 */
export default defineMiddleware<Message, RepeaterConfig>({
  target: 'inbound',
  async handle(context, next) {
    // Per-conversation effective configuration (ADR 0055); falls back to the global view.
    const resolver = context.has(repeaterConfigToken) ? context.use(repeaterConfigToken) : undefined;
    const config = { ...context.config, ...(resolver?.configFor(context.input) ?? {}) } as RepeaterConfig;
    const engine = context.use(repeaterEngineToken);
    const result = engine.tick({
      conversation: context.input.conversation,
      content: context.input.content,
      sender: context.input.sender,
      metadata: context.input.metadata,
    }, config);

    if (result.action === 'repeat') {
      await context.input.$reply(result.content);
      return;
    }
    await next();
  },
});
