import type { Token } from './token.js';
import { outboundHostToken, type OutboundConversation, type OutboundHost, type OutboundSendInput } from './outbound-host.js';

/**
 * 结构兼容 CapabilityContext.use()、Scope.use()、EndpointCommandUse 的最小访问器。
 */
export type UseAccessor = <T>(token: Token<T>) => T;

/**
 * 预绑定 adapter + endpoint 的发送器。
 *
 * ```ts
 * const sender = createOutboundSender(context.use, 'root/icqq', 'main');
 * await sender.send('group', '67890', 'hello');
 * await sender.send({ kind: 'private', id: '12345' }, 'DM');
 * ```
 */
export interface OutboundSender {
  send(kind: OutboundConversation['kind'], id: string, content: string): Promise<string | null>;
  send(conversation: OutboundConversation, content: string): Promise<string | null>;
  readonly host: OutboundHost;
  readonly adapter: string;
  readonly endpointId: string;
}

/**
 * 创建预绑定 adapter + endpoint 的发送器。
 *
 * 在 defineCommand 中：
 * ```ts
 * const sender = createOutboundSender(context.use, 'root/telegram', 'main');
 * await sender.send('group', 'chat123', 'hello');
 * ```
 *
 * 在 definePlugin setup 中：
 * ```ts
 * const sender = createOutboundSender(
 *   (token) => context.resources.use(token),
 *   config.adapter,
 *   config.endpointId,
 * );
 * ```
 */
export function createOutboundSender(
  use: UseAccessor,
  adapter: string,
  endpointId: string,
): OutboundSender {
  const host = use(outboundHostToken);
  return Object.freeze({
    host,
    adapter,
    endpointId,
    send(
      kindOrConversation: OutboundConversation['kind'] | OutboundConversation,
      idOrContent: string,
      maybeContent?: string,
    ): Promise<string | null> {
      if (typeof kindOrConversation === 'string' && maybeContent !== undefined) {
        return host.send({
          adapter,
          endpointId,
          conversation: { kind: kindOrConversation, id: idOrContent },
          content: maybeContent,
        });
      }
      return host.send({
        adapter,
        endpointId,
        conversation: kindOrConversation as OutboundConversation,
        content: idOrContent,
      });
    },
  });
}

/**
 * 一次性发送：解析 OutboundHost 并发送到指定目标。
 *
 * ```ts
 * await sendTo(context.use, {
 *   adapter: 'root/icqq',
 *   endpointId: 'main',
 *   conversation: { kind: 'group', id: '67890' },
 * }, 'hello');
 * ```
 */
export async function sendTo(
  use: UseAccessor,
  target: Omit<OutboundSendInput, 'content'>,
  content: string,
): Promise<string | null> {
  const host = use(outboundHostToken);
  return host.send({ ...target, content });
}
