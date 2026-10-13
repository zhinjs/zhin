# @zhin.js/schedule-feature

Plugin Runtime 的 generation-owned Schedule Feature。插件在 `schedules/<name>/index.ts` 默认导出 `defineSchedule(...)`；同目录其他文件是 helper，不会被解析成任务。

```ts
import { defineSchedule } from '@zhin.js/schedule-feature';
import { reportServiceToken } from './report-service.js';

export default defineSchedule({
  cron: '0 0 9 * * *',
  description: 'Daily report',
  async execute(ctx) {
    await ctx.use(reportServiceToken).sendDailyReport();
  },
});
```

也可在 `plugin.ts` 的 `setup({ addSchedule })` 中注入同一定义。Feature 在新 generation 激活时通过 owner-scoped `scheduleHostToken` 注册任务，并在旧 generation lease 释放后撤销旧注册。

`execute(ctx)` 的 `owner`、`generation`、`config`、`use(token)` 与 `project(feature)` 来自本次任务所属的 generation。目录声明和 `addSchedule` 使用同一接口；旧代停止接纳新执行，已进入的任务通过现有操作 lease 完成。无入站消息的后台任务不提供 Message、sender 或交互。

可以用 `defineSchedule<MyConfig>()` 标注插件配置。跨重启的提醒、取消状态和投递目标应存入 owner 的 PersistentState；不要把 `ctx`、snapshot、Message、Client 或回调写入 cache 文件。cron、重叠、错过执行和投递未知的处理是不同问题，插件应明确业务策略，不能把再次执行等同于安全重试。
