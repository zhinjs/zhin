# @zhin.js/schedule-feature

Plugin Runtime 的 generation-owned Schedule Feature。插件在 `schedules/<name>/index.ts` 默认导出 `defineSchedule(...)`；同目录其他文件是 helper，不会被解析成任务。

```ts
import { defineSchedule } from '@zhin.js/schedule-feature';

export default defineSchedule({
  cron: '0 0 9 * * *',
  description: 'Daily report',
  async execute() {
    // work
  },
});
```

也可在 `plugin.ts` 的 `setup({ addSchedule })` 中注入同一定义。Feature 在新 generation 激活时通过 owner-scoped `scheduleHostToken` 注册任务，并在旧 generation lease 释放后撤销旧注册。
