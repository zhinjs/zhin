---
"@zhin.js/plugin-ledger": patch
---

记账在私聊中把用户真实的私聊会话保存到新表 `ledger_private_targets`（不改动已有的 `ledger_users`，已部署的数据库无需迁移），群聊私信与记账日报优先投递到该会话；Discord、飞书等私聊会话 ID 不等于用户 ID 的平台不再投递失败（尚未私聊过时仍回退到用户 ID）。
