---
"@zhin.js/agent": minor
"zhin.js": minor
---

#1250 第 83 批：Agent 管理命令改为 Root 命令，和 `bind`、`config`、`restart`、`language` 一样走命令分发。

- `models`、`health`、`tree`（`tree N`）、`fork N`、`compact`、`reset`，以及启用语义记忆时的 `memory`、`memory forget <key|id|all>`，由 zhin 实例的 Agent Host 注册（未安装 Agent 时不存在）。它们出现在菜单 / 帮助里，有近似指令提示，参数由命令模块解析（`tree 0`、`fork` 缺编号等给出用法），处理结果记 `command_replied`；命令认领的消息不进入 AI 回合。都不设冷却。
- 权限：`models`、`health`、`tree`、`fork`、`compact` 声明 permit `trusted`（本会话链上任一 zhin 聊天角色，与原来的「有宿主聊天角色」判定等价），菜单只给有权限的人列出；群里无权限者静默（`permission_denied`，原因 `denied:trusted`），私聊回复原因。`reset` 自行判定同一条件，无权限时私聊回复并指引改发 `/clear`（群里静默，原因 `not_operator`）；成功归档的固定确认仍记为本会话自己的投递（ADR 0067 D8）。`memory` 对所有人开放，只作用于发送者自己的记忆；语义记忆未就绪时回复「未启用长期记忆」，不再交给 AI。
- （不兼容）删除无前缀 `ai.health`（改用 `health` 命令）；`forget` 改为 `memory forget`。
- `@zhin.js/agent`：（不兼容）删除 `handleRuntimeManagementCommand`、`RuntimeManagementDeps`、`RuntimeManagementSenderRoles`；新增 `createRuntimeManagementCommands()`、`RUNTIME_MANAGEMENT_PERMIT` 与类型 `RuntimeManagementCommand`、`RuntimeManagementCommandHost`、`RuntimeManagementOperation`；`AgentTurnIngressRoute` 新增 `runManagementOperation()` 与选项 `acquireLease`。入站管理阶段（`tryHandleIngressCommands`）只保留带短码的 `rule …`、`approve …` / `deny …` 与主人 `/approve …`，其上下文去掉 `lease`、`operationSignal`、`sessionKey`、`senderRoles`、`withInference`、`withModelScope`、`replyFixed`。
