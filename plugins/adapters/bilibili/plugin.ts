import { definePlugin, outboundHostToken, pluginConsoleRpcToken } from 'zhin.js';
import {
  bilibiliNotifierToken,
  type BilibiliNotifier,
} from './src/bilibili-runtime-state.js';
import { createBilibiliConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/bilibili` 轮询白名单视频评论（可选「回复我的 / @我的」），出站只进草稿队列（落盘，重启不丢）。
 * - Commands: `bili-draft list|show|edit|send|drop`、`bili-login start|status`（仅 master）。
 * - Page: `pages/index` →「评论审批」：扫码登录、白名单视频、待审草稿的发送 / 改写 / 丢弃。
 */
export default definePlugin({
  name: 'bilibili',
  metadata: {
    displayName: 'Bilibili Comment Adapter (Experimental)',
  },
  setup(context) {
    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    const notifier: BilibiliNotifier = async (target, text) => {
      if (!outbound) return false;
      await outbound.send({
        adapter: target.adapter,
        endpointKey: target.endpoint,
        conversation: { kind: target.kind, id: target.id },
        content: text,
      });
      return true;
    };
    context.resources.provide(bilibiliNotifierToken, notifier);
    context.resources.provide(pluginConsoleRpcToken, createBilibiliConsoleRpc());
  },
});
