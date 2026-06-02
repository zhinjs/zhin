/**
 * Inbound runner — one ordered entry for IM message.receive processing.
 */

import { Message, type Message as MessageType } from '../message.js';
import type { Plugin } from '../plugin.js';
import type { MessageDispatcherService } from './dispatcher.js';

export interface RunInboundMessageOptions {
  plugin?: Plugin | null;
  message: MessageType<any>;
  emitAdapterObservers: () => void;
}

export interface InboundRunResult {
  dispatched: boolean;
}

function getDispatcher(plugin?: Plugin | null): MessageDispatcherService | undefined {
  const dispatcher = plugin?.inject('dispatcher');
  if (dispatcher && typeof dispatcher.dispatch === 'function') {
    return dispatcher as MessageDispatcherService;
  }
  return undefined;
}

/**
 * Ordered IM inbound pipeline:
 * root plugin middleware (命令、Prompt / ask_user 等一次性监听) → 作为终端调用
 * MessageDispatcher（护栏 / 路由 / AI）→ 根插件 `message.receive` 生命周期 → adapter observers。
 *
 * 适配器可能挂在子插件上，故中间件始终走 `plugin.root`，与 `addMiddleware` 注册在根插件上的
 * Agent / 业务逻辑一致。
 */
export async function runInboundMessage(options: RunInboundMessageOptions): Promise<InboundRunResult> {
  const { plugin, message, emitAdapterObservers } = options;
  Message.syncQuoteId(message);
  const dispatcher = getDispatcher(plugin);
  const root = plugin?.root;

  if (dispatcher && root) {
    await root.middleware(message, async () => {
      await dispatcher.dispatch(message);
    });
  } else if (dispatcher) {
    await dispatcher.dispatch(message);
  }

  plugin?.dispatch('message.receive', message);
  emitAdapterObservers();
  return { dispatched: !!dispatcher };
}

