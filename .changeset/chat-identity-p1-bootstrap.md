---
"@zhin.js/core": minor
"zhin.js": minor
"@zhin.js/console-protocol": minor
"@zhin.js/cli": patch
---

聊天角色的引导与种子导入（ADR 0060 P1）：

- 公共 API：`isOwner(sender, { level })`（默认全局 owner）、`hasChatRole(sender, role, { level })`，以及只读的 `chatRolesToken`（`ChatRoleReader`：`roleOf` / `principalOf` / `holders` / `factsOf` / `subscribe`），插件不再需要自建 `masters` 名单。
- 认领码：没有全局 owner 且数据库为关系型时，实例日志与 `zhin status` 给出一次性认领码；在真实平台私聊机器人发送 `认领 <码>`（`claim <code>`）成为全局 owner。群聊中发送正确的码会立即作废，连错 5 次轮换，模拟适配器上不接受；审计 `chat-roles.claim` 只记码哈希前 8 位。
- 配置中的人员名单（适配器 `master` / `trusted`、`ai.trigger.*`）在导入完成后再次出现不再启动失败：不自动授予，记入迁移记录后从配置移除，等待持有全局 `iam.manage` 的 Console 用户通过新 RPC `chat-roles.imports.list|resolve` 逐条导入或忽略（审计 `chat-roles.import`）。导入只升不降；迁移记录升为版本 2，原版本 1 保存为 `.zhin/chat-roles-migration.v1.json` 供回滚。
- 「需要你处理」新增 `chat-roles.no-owner`、`chat-roles.imported`、`chat-roles.import-pending`（仅全局 `iam.manage` 可见）。
