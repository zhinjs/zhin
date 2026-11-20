---
"@zhin.js/plugin-lottery": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/agent": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/adapter-github": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-answers": patch
"@zhin.js/process-monitor": patch
---

日期统一用 `formatDateTime`（zhinjs/zhin#1250 第 76 批）。不新增导出。

- 修复：彩票插件的每日推荐、待评预测与"今天"判断，以及 B 站 `bili-login` 的登录过期日期，之前用 `toISOString()` 取 UTC 日期，北京时间 0–8 点会显示成前一天；现在按进程时区（`TZ`，否则系统时区）取日历日。彩票的 `predict_date` 也按同一时区记录，升级前在 0–8 点记下的待评预测仍是 UTC 日期。
- 显示改为仓库统一的 `YYYY-MM-DD HH:mm:ss`：`schedule_add` 一次性任务的执行时间（之前 `zh-CN` 本地格式）、RSS 预览条目时间（之前随语言变化，无法解析的日期原样显示）、GitHub `whoami` 的绑定时间、提醒任务详情（之前 `dateStyle: 'short'`，仍用配置的时区）。地震事件时间输出不变，零点不再可能显示为 `24`。
- 记账、答案之书、进程监控与会话提醒的日期键改用 `formatDateTime`，输出不变。
