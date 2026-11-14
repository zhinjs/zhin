import { definePlugin, outboundHostToken } from 'zhin.js';
import { juejinNotifierStore, type JuejinNotifier } from './src/juejin-runtime-state.js';
import { createJuejinConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/juejin` 轮询白名单文章评论，出站只进草稿队列（落盘，重启不丢）。
 * - Commands: `juejin-draft list|show|edit|send|drop`、`juejin-login status`（仅聊天角色 owner）。
 * - Page: `pages/index` →「掘金评论审批」：登录态、白名单文章、待审草稿的发送 / 改写 / 丢弃。
 */
export default definePlugin({
  name: 'juejin',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Juejin Comment Adapter (Experimental)',
    displayNameI18n: { 'zh-CN': '掘金评论适配器（实验性）', en: 'Juejin Comment Adapter (Experimental)' },
  },
  setup(context) {
    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    const notifier: JuejinNotifier = async (target, text) => {
      if (!outbound) return false;
      await outbound.send({
        adapter: target.adapter,
        endpointKey: target.endpoint,
        conversation: { kind: target.kind, id: target.id },
        content: text,
      });
      return true;
    };
    juejinNotifierStore.provide(context, () => notifier);
    return {
      consoleRpc: createJuejinConsoleRpc(),
    };
  },
});
