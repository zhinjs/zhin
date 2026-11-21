---
"@zhin.js/agent": minor
"zhin.js": minor
---

#1250 第 83 批：Agent 管理命令改为 Root 命令，和 `bind`、`config`、`restart`、`language` 一样走命令分发。

- `models`、`health`、`tree`（`tree N`）、`fork N`、`compact`、`reset`，以及启用语义记忆时的 `memory`、`memory forget <key|id|all>`，由 zhin 实例的 Agent Host 注册（未安装 Agent 时不存在）。它们出现在菜单 / 帮助里，有近似指令提示，参数由命令模块解析（`tree 0`、`fork` 缺编号等给出用法），处理结果记 `command_replied`；命令认领的消息不进入 AI 回合。都不设冷却。
- 权限：`models`、`health`、`tree`、`fork`、`compact` 声明 permit `trusted`（本会话链上任一 zhin 聊天角色，与原来的「有宿主聊天角色」判定等价），菜单只给有权限的人列出；群里无权限者静默（`permission_denied`），私聊回复原因；拒绝原因只有 `denied:trusted` 一种（不再有 `not_operator`）。
- `reset` 对所有人开放，菜单里人人可见：有聊天角色的人发它直接归档当前会话（成功归档的固定确认仍记为本会话自己的投递，ADR 0067 D8）；其他人发 `reset` 等同 `/clear`——同一条清空路径、AI 触发与 @ 要求、确认冷却、控制面与发言闸门，不再回复无权限或「改发 /clear」的引导。
- 只回应人：消息来源标为其他机器人（`origin` 不是 `human`）时这些命令不回复、不执行，结局 `filtered_by_policy`（原因 `non_human_origin`），与改前 Agent 入站的处理一致。
- 命令在分发它的那一代上运行：推理与模型操作持有的是这条消息被分发时那一代的租约（Host 操作资源里的分发租约），不再取当前最新一代。没有 Host 模型操作时 `tree N`、`fork`、`compact` 报错，不再直接执行。
- `memory` 在群聊 / 频道里不再把发送者的记忆公开到群里，只提示「记忆只在私聊里列出，请私聊机器人发送 /memory 查看」（中英文）；私聊照常列出。`memory forget` 在群里照常执行，只回复遗忘了几条，不回显记忆内容。`memory` 只作用于发送者自己的记忆；语义记忆未就绪时回复「未启用长期记忆」，不再交给 AI。
- （不兼容）删除无前缀 `ai.health`（改用 `health` 命令）；`forget` 改为 `memory forget`。
- `@zhin.js/agent`：（不兼容）删除 `handleRuntimeManagementCommand`、`RuntimeManagementDeps`、`RuntimeManagementSenderRoles`；新增 `createRuntimeManagementCommands()`、`RUNTIME_MANAGEMENT_PERMIT` 与类型 `RuntimeManagementCommand`、`RuntimeManagementCommandHost`（`open(message, dispatch, run)`、`clear(message, dispatch)`）、`RuntimeManagementDispatch`、`RuntimeManagementOperation`；`AgentTurnIngressRoute` 新增 `runManagementOperation()` 与 `clearAsCommand()`；`createHostOperationResources()` 的 IM 操作资源额外提供分发租约（内部令牌）。入站管理阶段（`tryHandleIngressCommands`）只保留带短码的 `rule …`、`approve …` / `deny …` 与主人 `/approve …`，其上下文去掉 `lease`、`operationSignal`、`sessionKey`、`senderRoles`、`withInference`、`withModelScope`、`replyFixed`。
