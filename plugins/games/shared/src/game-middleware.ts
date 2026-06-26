import type { MessageMiddleware, Plugin, RegisteredAdapter } from 'zhin.js';

/**
 * 在 root 插件上注册游戏文本中间件（入站管线只走 root.middleware）。
 */
export function registerGameTextMiddleware(
  plugin: Plugin,
  middleware: MessageMiddleware<RegisteredAdapter>,
  name?: string,
): () => void {
  const dispose = plugin.root.addMiddleware(middleware, name);
  plugin.onDispose(dispose);
  return dispose;
}
