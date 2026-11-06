import {
  definePlugin,
  definePluginCapabilityGraph,
  pluginConsoleRpcToken,
} from 'zhin.js';
import { createModerationConsoleRpc } from './src/console.js';
import { ModerationEngine } from './src/engine.js';
import { moderationEngineStore } from './src/runtime.js';

export default definePlugin({
  name: 'content-moderation',
  metadata: {
    displayName: 'Content Moderation',
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [moderationEngineStore, pluginConsoleRpcToken],
    features: {
      middlewares: ['inbound', 'outbound'],
      skills: ['content-moderation'],
      tools: ['moderation_check', 'moderation_status'],
      pages: ['index'],
    },
  }),
  setup(context) {
    // 每个 generation 配置一次：providers 构建与词库 readFileSync 都在
    // configure 内，绝不能放在每条消息的中间件热路径上。
    // provide 自动挂 lifecycle 反注册，代际结束即摘除。
    const engine = new ModerationEngine();
    engine.configure(context.config.get());
    moderationEngineStore.provide(context, engine);
    context.events.on('hmr.resume', ({ details }) => {
      if (details.outcome !== 'committed') return;
      engine.groupReviewQueue.cancelReplacedSources(details.replaced);
      if (details.receiver.state === 'replaced') engine.groupReviewQueue.stop();
    });
    return {
      consoleRpc: createModerationConsoleRpc(engine),
      dispose: () => engine.groupReviewQueue.stop(),
    };
  },
});
