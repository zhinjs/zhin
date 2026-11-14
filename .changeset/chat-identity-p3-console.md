---
"@zhin.js/agent": minor
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/adapter-sandbox": patch
---

聊天身份 P3（ADR 0060）：Sandbox 以我发言、`ai.personalPrincipals` 改读链接。

- **Sandbox 安全修复**：Console Sandbox 客户端自填的发送者 ID 一律是模拟身份——服务端写成保留 id `~sim:<id>`，不解析任何 zhin 角色，信任档位最低；填 owner 的 id 不再能冒充 owner。以 `~` 开头的发送者 id 不是聊天身份（`isChatIdentity` 为 false），不能持有、被授予或解析角色，也不记入最近发言人。
- Sandbox 新增「以我的聊天身份发言」（默认开启）：已登录的 Console 用户按其链接的人在 Sandbox 上的身份发言，角色按该人的授予解析；未登录（引导令牌）与 `--standalone` 一律按模拟身份。新 RPC `chat-identities.simulated.ensure`（`self.chat-identity`）为调用者的人（没有则新建并链接）在模拟适配器上建立身份，不触及真实平台。`ChatRoleReader` 新增可选方法 `consoleSpeaker`。
- `ai.personalPrincipals` 首次启动导入为「人 ↔ Console 账号」链接（不授予角色）；`rootId` 与当前目录不一致不再导致启动失败（按别名 + subjectId 导入并告警）；之后个人推理主体只读链接表。`@zhin.js/agent`：`HostInferenceOptions.personalOwners` 可为函数（每次管理租约读取），`resolveInferenceManagementPrincipal` 的 `bindings` 可为函数，且 `full` 范围允许切换到调用者自己的个人推理主体；新增 `personalOwnersOfIdentities` / `chatIdentityOfPersonalOwner`。
- 「需要你处理」`chat-roles.imported` 列出 `ai.personalPrincipals` 导入的链接；若被链接的 Console 用户就是当前查看者且尚无全局 owner，提示「是否同时设为全局 owner」。确认已读同时标记该导入。
- 聊天 `角色 授予 / 撤销` 可用 `#<人 id 前缀>` 引用一个人（前缀唯一时）。
