---
"@zhin.js/plugin-runtime": minor
"@zhin.js/runtime": minor
"@zhin.js/console-protocol": minor
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/schema": patch
"zhin.js": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-rss": patch
---

功能配置新增第四级「会话」（ADR 0055），并引入聊天角色（ADR 0056）。

- `@zhin.js/plugin-runtime`：会话解析键与转义、会话覆盖读取令牌，门禁与缓存按会话判断；锁定可来自账号层。
- `@zhin.js/runtime`：`x-zhin-config.levels` 支持 `conversation`，新增 `conversationFields` / `selfServiceFields` / `chatAdminFields` 声明与会话覆盖校验；`configFor` / `isEnabledFor` 解析到会话层；Host 配置新增 `features.selfService`。
- `@zhin.js/console-protocol`：`feature.*` 支持 `level: 'conversation'`，新增 `feature.conversations`、`chat-roles.list|grant|revoke` 与 `featureScopeTarget`；被上级锁定的写入返回 409 `locked`；`iam.manage` 可按作用域绑定（仅 `chat-roles.*`）。
- `@zhin.js/core`：命令、中间件、处理器的门禁按消息所在会话判断。
- `@zhin.js/agent`：Agent 工具与技能披露按会话层功能开关判断。
- `@zhin.js/schema`：新增 `Schema.object(...).featureLevels(...)`，声明插件根的分层级别与会话字段。
- `zhin.js`：实例新增会话级功能覆盖存储、聊天角色、`chat-roles.*` RPC 与群内「功能」「角色」命令（默认关闭）；所有层级的启停按「上级停用则下级锁定」执行。
- `@zhin.js/plugin-repeater`：支持按群覆盖复读阈值与冷却，群管理员可在聊天中调整阈值。
- `@zhin.js/plugin-rss`：支持按群关闭 RSS，被关闭的会话不再收到推送。
