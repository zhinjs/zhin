---
"@zhin.js/plugin-runtime": minor
"@zhin.js/schedule-feature": patch
"zhin.js": patch
"@zhin.js/host-http": patch
"@zhin.js/game-kit": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-roulette": patch
---

定时任务（#1250）：`ScheduleJobRegistration` / `defineSchedule()` 新增可选 `title`、`titleI18n`、`kind`（`plugin-internal` 默认 / `user-task`）；实例 Schedule Host 记录每个任务最近一次实际执行的开始 / 结束时间与成功 / 失败（`lastRun`）。`schedule:list` / `cron:list` 的内存任务行新增可选 `kind`、`title`（按请求 `locale` 解析）、`titleI18n`、`displayName`、`lastExecutedAt`、`lastFinishedAt`、`lastDurationMs`、`lastStatus`、`lastError`，持久任务行新增 `kind: 'user-task'`。官方插件的内部轮询任务补中文标题。
