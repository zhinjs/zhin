import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  getRepeaterEngine,
  resolveRepeaterConfig,
  type RepeaterConfig,
} from '../src/engine.js';

/**
 * Runtime `Message` 是 conversation 原生：`conversation.kind/id` 直接喂给引擎
 * （引擎契约 `RepeaterInboundFields.conversation`，私聊由引擎判 null 跳过）。
 * Sender 为 MessageSenderRef（`{ id, name?, roles? }`），引擎只读 `id`。
 * Reply uses `Message.$reply` (available during inbound middleware scope).
 */
export default defineMiddleware<Message, RepeaterConfig>({
  target: 'inbound',
  async handle(context, next) {
    const config = resolveRepeaterConfig(context.config);
    const engine = getRepeaterEngine();
    const result = engine.tick({
      conversation: {
        kind: context.input.conversation.kind,
        id: context.input.conversation.id,
      },
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
