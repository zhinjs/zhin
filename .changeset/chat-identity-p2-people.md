---
"@zhin.js/core": minor
"zhin.js": minor
"@zhin.js/console-protocol": minor
"@zhin.js/cli": minor
"@zhin.js/gateway": patch
---

聊天身份的「人」模型（ADR 0060 P2）：

- 角色授予属于「人」：新实例表 `chat_principals`、`chat_identities`（一个平台身份至多属于一个人）、`chat_principal_console_links`（Console 用户与人一对一，缓存 Console 显示名）。全局授予对一个人的全部平台身份生效；低于全局的授予只对该作用范围所属适配器上的身份生效。
- `chat_roles` 原地新增 `principal_id` 列：首次启动为已有授予的身份各建一个人并回填（幂等），迁移前全部授予导出到 `.zhin/backups/chat-roles-<时间>.json`；过渡期双写 `adapter` / `user_id` 并保持原行 id，降级到旧版本角色不变（回滚见升级指南）。
- 入站消息新增 Runtime 写入的只读 `sender.chatPrincipal`，适配器或插件自带的同名字段被丢弃；`ChatRoleReader.principalOf` / `holders` 返回真实的人，`subscribe` 新增 `merge` / `split` 变化，`factsOf` 返回 `chatPrincipal`。
- 新 Console RPC：`chat-principals.list|get|merge|split|rename|link-console|unlink-console|export|import`、`chat-identities.recent|me|bind-code.create`，全部登记到权限表；新权限 `self.chat-identity`（所有内置角色默认带）。归并 / 拆分持有全局角色的人、链接 Console 用户、导出导入需要全局 `iam.manage`。`chat-roles.*` 条目新增 `grantedByName` 与 `principalId`。
- 聊天侧新增 `绑定 <码>`（`bind <code>`）：只接受私聊，群聊中发送的正确码立即作废，模拟适配器不接受；审计 `chat-identities.bind`、`chat-principals.merge|split|rename|link-console|unlink-console`。
- 最近发言时间与显示名缓存保留 90 天（供选择器，不参与鉴权）。
- CLI：`zhin chat-roles export [文件]` / `zhin chat-roles import <文件>`（经运行中实例；导入只新增或提升）。
- 网关：Console 用户被删除或禁用时若实例不在线，在实例重新就绪后补发通知，实例据此删除该用户的链接。
