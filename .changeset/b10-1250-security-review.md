---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
---

#1250 安全复核修复：配置补丁把敏感字段的值移入 `.env` 需要 `ops.env.write`，否则以 `env-write-required` 拒绝（聊天自助与 Agent 自改同样拒绝），且只更新字段自己的规范变量、绝不覆盖字段仅仅引用的其他变量；CLI 的 `/pub/health` 项目核对在探测失败时按"未验证"处理（默认拒绝，`--allow-unverified-host` 时警告后继续），本机判定覆盖 `0.0.0.0`、`::ffff:127.x`、`*.localhost` 与本机网卡地址，`hostFetch` 不再以明文 HTTP 向非回环地址发送令牌；模型连接测试（`/probe`、`/account/test`）按账号限流（每分钟 6 次，超出返回 429 与 `retryAfterMs`）。
