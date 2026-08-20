// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 定时任务在 plugin.ts 的 setup() 中通过 ScheduleHost 注册（参考 plugins/utils/lottery）。
// Host 是可选资源：先 has() 再 use()，否则在未安装该 Host 的精简环境下会装配失败。
import { definePlugin, scheduleHostToken } from 'zhin.js/plugin-runtime';

interface MyPluginConfig {
  pollCron?: string;
  scheduleEnabled?: boolean;
}

export default definePlugin<MyPluginConfig>({
  name: 'my-plugin',
  metadata: {
    displayName: 'My Plugin',
  },
  setup(context) {
    const config = context.config.get();
    if (!context.resources.has(scheduleHostToken) || config.scheduleEnabled === false) {
      return;
    }

    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'my-plugin/poll',              // 全局唯一，建议 `<plugin>/<job>`
      cron: config.pollCron || '*/5 * * * *',
      description: '每 5 分钟轮询一次',
      async execute() {
        // 共享连接/数据库请在 setup() 中 provide 成 owner Resource 后在此闭包读取，
        // 不要 import 模块级可变单例。
      },
    });

    // 必须登记 disposer：generation 回滚/热更新时用它取消任务，否则会重复注册。
    context.lifecycle.add(dispose);
  },
});

// ── 另一种：agent/ 授权面的定时任务（按目录发现） ─────────────────────────────
// agent/schedules/poll.ts
//
// import { defineSchedule } from '@zhin.js/agent';
//
// export default defineSchedule({
//   cron: '*/5 * * * *',
//   description: '每 5 分钟轮询一次',
//   async execute() {},
// });
