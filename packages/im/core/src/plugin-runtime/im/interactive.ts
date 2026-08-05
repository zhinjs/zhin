import { resolvePayloadFromText } from '../../built/interactive-segments/action.js';
import { keyboardFallbackStore } from '../../built/interactive-segments/fallback-store.js';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { Segment } from '../../built/segment-contract/types.js';
import type { Message } from './contracts.js';

/**
 * Plugin Runtime IM 管线的 interactive action 回跳（旧轨
 * `built/interactive-segments/handlers.ts` 的等价物）：
 * - 平台 callback 以 canonical action 段入站（telegram / discord，Wave 1 C 约定
 *   `{type:'action', data:{id, payload, sourceMessageId?}}`）；
 * - 'text' 端点的数字回跳：出站降级写入中央 fallback 存储的映射在此解析回 payload；
 * - QQ 指令预填等直出 `prefix:session:id` 文本同样识别。
 * payload 按 prefix 最长匹配路由给 `ImRuntime.registerInteractiveHandler`
 * 注册的 handler。
 */

export type RuntimeInteractiveHandler = (message: Message) => Promise<boolean> | boolean;

export interface RegisteredRuntimeInteractiveHandler {
  readonly prefix: string;
  readonly handler: RuntimeInteractiveHandler;
}

/** 频道键：出站降级写入与入站回跳读取共用（由 ConversationRef 派生，稳定即可）。 */
export function runtimeInteractiveConversationKey(conversation: ConversationRef): string {
  const base = `${String(conversation.endpoint.id)}~${conversation.kind}:${conversation.id}`;
  const parent = conversation.parent
    ? `@${conversation.parent.kind}:${conversation.parent.id}`
    : '';
  const thread = conversation.threadId ? `#${conversation.threadId}` : '';
  return `${base}${parent}${thread}`;
}

/** prefix 最长匹配（与旧轨 findHandler 一致）。 */
export function findRuntimeInteractiveHandler(
  handlers: readonly RegisteredRuntimeInteractiveHandler[],
  payload: string,
): RuntimeInteractiveHandler | undefined {
  let match: RegisteredRuntimeInteractiveHandler | undefined;
  for (const entry of handlers) {
    if (payload.startsWith(entry.prefix)) {
      if (!match || entry.prefix.length > match.prefix.length) {
        match = entry;
      }
    }
  }
  return match?.handler;
}

/**
 * 从入站消息解析 interactive payload：
 * action 段 → 中央 fallback map（裸数字）→ 指令预填直出 payload。
 */
export function resolveRuntimeInteractivePayload(message: Message): string | undefined {
  const fromSegments = actionPayloadFromSegments(message.segments);
  if (fromSegments) return fromSegments;
  const raw = message.content.trim();
  if (!raw) return undefined;
  return resolvePayloadFromText(
    raw,
    keyboardFallbackStore.mapFor(
      runtimeInteractiveConversationKey(message.conversation),
    ),
  );
}

function actionPayloadFromSegments(segments: readonly Segment[] | undefined): string | undefined {
  for (const seg of segments ?? []) {
    if (seg.type !== 'action') continue;
    const payload = (seg.data as { payload?: unknown } | undefined)?.payload;
    if (typeof payload === 'string' && payload) return payload;
  }
  return undefined;
}
