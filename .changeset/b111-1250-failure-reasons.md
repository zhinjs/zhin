---
"@zhin.js/agent": patch
"@zhin.js/adapter": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
---

**失败原因不再丢失**（#1250 b111）。

- 定时任务：失败通知本身发不出去时（发送抛错，或路由返回 `delivered: false`），记一条 warn 日志 `schedule_failure_notice_undelivered`（任务 id、脱敏后的目标 `im:平台/账号/类型:前两位***`、脱敏并截断的原因），并在该次运行的 `lastError` 末尾标注「；失败通知未送达（原因）」（有待执行的自动重试说明时放在它之前）。以前两处都是 `.catch(() => {})`，什么都不留。
- `schedule_add` / `schedule_update`：`delay_minutes` 必须是 1～525600（365 天）的整数分钟，`at_ms` 必须是 365 天以内的未来时间，`budget_timeout_ms` 不能超过 Node 定时器上限（约 24.8 天）；不合规时工具返回明确错误且不保存。以前过大的值会先保存任务、之后才抛 RangeError，可能留下重复任务；负数、小数、字符串的 delay 会被忽略。
- 企业微信、GitHub、飞书、OneBot 11 / 12 的身份核验错误带上平台的错误码与消息，并屏蔽账号的 secret、token、access token、私钥与 JWT。保存账号时身份核验失败，适配器层记一条 warn 日志（脱敏原因）；Console 的回复仍是固定文案。
