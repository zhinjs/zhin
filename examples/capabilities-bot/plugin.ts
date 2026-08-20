/**
 * capabilities-bot —— definePlugin 能力展示样板。
 * 一个 setup() 调动全部常用 Host 面；每一项都对应 docs/essentials/plugins.md
 * 的「definePlugin 能力全景」表。所有 Host 资源均为可选（has + use 降级），
 * 硬依赖请改用 `requires: [databaseHostToken]`（缺失即拒绝启动）。
 */
import {
  databaseHostToken,
  definePlugin,
  scheduleHostToken,
} from 'zhin.js/plugin-runtime';
import { defineAgentTool } from '@zhin.js/tool';

interface ShowcaseConfig {
  greeting: string;
  heartbeatCron: string;
}

export default definePlugin<ShowcaseConfig>({
  name: 'capabilities-bot',
  // Console /api/plugins 卡片展示：displayName / icon / order
  metadata: { displayName: 'Capabilities Bot', icon: 'Blocks', order: 10 },

  async setup(context) {
    // ① 实例视图：instanceKey / role / parent（多实例部署时按实例隔离）
    const { instanceKey } = context.plugin;

    // ② 配置视图：schema.json 声明默认值，zhin.config.yml 的 plugin: 段覆盖
    const config = context.config.get();
    const log = (text: string) => console.log(`[capabilities-bot] ${text}`);
    log(`setup: instance=${instanceKey} greeting=${config.greeting}`);

    // ③ 数据库（databaseHostToken）：define 表 + 计数器模型
    //    stats 命令经 command context 的 use(databaseHostToken) 复用同一张表
    if (context.resources.has(databaseHostToken)) {
      const db = context.resources.use(databaseHostToken);
      db.define('showcase_counter', {
        name: { type: 'text', nullable: false },
        count: { type: 'integer', nullable: false },
      });
      log('database: table showcase_counter defined');
    }

    // ④ 定时任务（scheduleHostToken）：6 段 cron；dispose 挂 lifecycle，HMR 安全回收
    if (config.heartbeatCron && context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      context.lifecycle.add(schedule.register({
        id: 'capabilities-bot/heartbeat',
        cron: config.heartbeatCron,
        description: 'Showcase heartbeat',
        execute: () => log('heartbeat ♥'),
      }));
      log(`schedule: heartbeat @ ${config.heartbeatCron}`);
    }

    // ⑤ Agent 工具：作为本 generation 的 Tool capability 原子发布
    context.addTool('showcase_greet', defineAgentTool<{ name?: string }>({
        description: 'Return the configured greeting for a name',
        approval: 'never',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        execute: (input) => `${config.greeting}，${String(input.name ?? 'world')}！`,
    }));
    log('agent-tools: showcase_greet projected');

    // ⑥ 卸载清理：setup 返回的 Dispose 会在 generation 结束时执行
    return () => log('disposed');
  },
});
