import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  getRepeaterEngine,
  resolveRepeaterConfig,
  type RepeaterConfig,
} from '../src/engine.js';

/**
 * Gaps vs legacy Message:
 * - Uses Runtime `Message.content` / `Message.sender` / `Message.target` / `Message.metadata`
 *   (no `$raw` / `$channel` / `$sender`).
 * - Group vs private relies on `metadata.type|channelType`; see `resolveGroupId`.
 * - Reply uses `Message.$reply` (available during inbound middleware scope).
 */
export default defineMiddleware<Message, RepeaterConfig>({
  target: 'inbound',
  async handle(context, next) {
    const config = resolveRepeaterConfig(context.config);
    const engine = getRepeaterEngine();
    const result = engine.tick({
      target: context.input.target,
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
