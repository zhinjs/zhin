---
"@zhin.js/kernel": patch
"@zhin.js/adapter-wechat-mp": patch
---

修复 ScheduleEngine every/at 任务回调异常未被捕获、超长延时被 Node 截断立即触发、at 回调内同 id 重注册被误删；修复微信公众号 access_token 并发刷新互相顶掉、expires_in 缺失时永不过期。
