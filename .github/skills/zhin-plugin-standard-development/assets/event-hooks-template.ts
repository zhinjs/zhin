// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 旧的 `plugin.on('message.group.receive')` / `plugin.on('before.sendMessage')` 事件钩子，
// 在 Plugin Runtime 中由 `middlewares/*.ts` 承担：
//   - 收到消息   -> target: 'inbound'
//   - 发送前改写 -> target: 'outbound'
// 一个文件一个中间件，default export。
//
//   my-plugin/
//     middlewares/
//       audit.ts       ← 本文件
import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';

export default defineMiddleware<Message>({
  target: 'inbound',              // 'inbound' | 'outbound'
  phase: 'before-dispatch',       // 'before-dispatch' | 'after-dispatch'
  order: 0,                       // 越小越先执行
  async handle(context, next) {
    // 注意与旧 Message 的差异：使用 Runtime 的 content / sender / target / metadata，
    // 没有 $raw / $channel / $sender。
    if (!String(context.input.content ?? '').trim()) {
      return;                     // 不调用 next() 即中断后续链路
    }

    await next();
  },
});

// ── 发送前改写：middlewares/outbound-rewrite.ts ──────────────────────────────
// export default defineMiddleware({
//   target: 'outbound',
//   async handle(context, next) {
//     // 改写出站内容；务必保持在发送链路内，不要绕过 Adapter.sendMessage
//     await next();
//   },
// });
//
// 需要在插件停止时释放资源，请在 plugin.ts 的 setup() 里
// `context.lifecycle.add(...)` 或返回 disposer —— 不要用旧的 plugin.onDispose()。
