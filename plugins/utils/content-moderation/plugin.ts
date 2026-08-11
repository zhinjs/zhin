import { definePlugin } from '@zhin.js/plugin-runtime';
import { ModerationEngine, provideModerationEngine } from './src/engine.js';

export default definePlugin({
  name: 'content-moderation',
  metadata: {
    displayName: 'Content Moderation',
  },
  setup(context) {
    // 每个 generation 配置一次：providers 构建与词库 readFileSync 都在
    // configure 内，绝不能放在每条消息的中间件热路径上。
    // provide 自动挂 lifecycle 反注册，代际结束即摘除。
    const engine = new ModerationEngine();
    engine.configure(context.config.get());
    provideModerationEngine(context, engine);
  },
});
