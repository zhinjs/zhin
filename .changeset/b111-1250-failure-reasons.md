---
"@zhin.js/agent": patch
"@zhin.js/adapter": patch
"@zhin.js/logger": patch
"@zhin.js/kernel": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
---

**失败原因不再丢失**（#1250 b111）。

- 定时任务：失败通知本身发不出去时（发送抛错，或平台拒收），记一条 warn 日志 `schedule_failure_notice_undelivered`（任务 id、脱敏后的目标 `im:平台/账号/类型:前两位***`、先脱敏再截断的原因），并在该次运行的 `lastError` 末尾标注「；失败通知未送达（原因）」（有待执行的自动重试说明时放在它之前）。平台可能已收到但未确认（`deliveryUnknown`）时写「失败通知送达未确认」（日志 `schedule_failure_notice_unconfirmed`）；出站中间件有意压下（`suppressed`）的通知不算失败，只记 info 日志、不加备注。运行本身没有错误文本（未完成的运行）时，`lastError` 只写这条备注，不再写成 `unknown error`。一次性任务运行后已被删除时，没有地方可标注，只留日志。以前两处都是 `.catch(() => {})`，什么都不留。
- `schedule_add` / `schedule_update`：`delay_minutes` 是大于 0 的有限分钟数，可以是小数（`0.5` 即 30 秒），最少 1 秒、最多 525600（365 天），换算成毫秒时取整；`at_ms` 必须是 365 天以内的未来时间；`budget_timeout_ms` 不能超过 Node 定时器上限（约 24.8 天）。不合规时工具返回明确错误，新建时不保存、修改时不改动（文案分别是「任务未保存」「任务未修改」）。`schedule_add` 同时给 `cron` 和非 0 的 `delay_minutes` 时报错（与 `schedule_update` 一致），不再悄悄把周期任务建成一次性任务；`delay_minutes` 为 0 或不传时仍按 cron 建任务。以前：`schedule_add` 只认数字型的正 delay（小数照常接受），负数与字符串的 delay 被忽略（有 cron 时按 cron 建任务，没有时报「请提供 6 段 cron 表达式」），数字型的正 delay 和 cron 同时给时建成一次性任务；`schedule_update` 接受任意正数（含小数和数字字符串）；两处都没有上限，过大的值会先保存任务、之后才抛 RangeError，可能留下重复任务。
- 企业微信、GitHub、飞书、OneBot 11 / 12 的身份核验错误带上平台的错误码与消息，屏蔽账号的 secret、token、access token、私钥与 JWT，且一律先屏蔽再截断（横跨截断边界的密钥不会留下半截）。飞书非 2xx 响应会读取响应体里的 `code` / `msg`（脱敏后）附进错误（`Lark HTTP 400: <msg> (code <code>)`），读不出时仍只有状态码。GitHub 的 `token <值>` 规则只在值里含数字时屏蔽，`token expiration` 这类普通文本不再被误伤。企业微信获取 access token 失败的文案改为 `Failed to get access token (errcode N): <msg>` / `(HTTP N)`。
- 保存账号时身份核验失败，适配器层记一条 warn 日志（脱敏原因）；Console 的回复仍是固定文案。屏蔽集合除了经 secretRefs 解析出的密钥，还包括新旧两份配置里探针字段的值与所有长度 ≥ 8 的字符串（Console 新填的密钥以明文写在配置里）；文本规则改用与内核相同的 `redactSecretText`（覆盖 `token=…`、`{"secret":"…"}`、`access_token=…`、`Authorization: token …` 等）。
- `redactSecretText` 的文本规则下沉到 `@zhin.js/logger`（新导出 `redactSecretText`），`@zhin.js/kernel` 原样转出，供不能依赖内核的提供方层包使用；新增 PEM 规则：`-----BEGIN … ----- … -----END …-----` 整块屏蔽（单行或多行），缺 END 的私钥块屏蔽到文本末尾。
