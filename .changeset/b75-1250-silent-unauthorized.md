---
"@zhin.js/agent": minor
"@zhin.js/core": patch
"zhin.js": patch
---

#1250 第 75 批：群里无权限者发确认 / 审批 / 管理类命令时，机器人不回复、不执行，避免旁人乱操作刷屏；私聊照旧回复无权限原因，有权限的人操作出错（确认码过期、格式不对等）照常提示。这些拒绝都记为入站结局 `permission_denied`（群里 `reply: no`，私聊 `reply: yes`），Console「消息结局」可查；原有审计照常写。

- `@zhin.js/agent`：Agent 管理命令（`models`、`tree`、`fork`、`compact`、`reset`、`ai.health`）对非主人 / 受信任用户、审批卡命令 `approve <id>` / `deny <id>` 对不在审批人名单且不是能结算该自我变更卡的全局主人、主人命令 `approve …` 对非全局主人（全局主人在群里发仍提示改用私聊）、群规命令 `rule approve|reject|disable …` 对非群管理员 / 非审批人：在群聊与频道里不回复，消息在入站管理阶段终止，不会再进入 AI 回合（模型不会代为回答「没有权限」）；私聊回复不变。`rules` 列表、`memory` / `forget` 仍对所有人开放。`RuntimeManagementDeps`、`ImApprovalCommandInput`、`GroupRuleCommandInput`、`OwnerApprovalCommandContext` 新增可选回调 `onUnauthorized(reason)`：处理器在回复是「无权限拒绝」时调用它（返回的文案不变），由入站阶段决定群里静默、私聊回复。
- `@zhin.js/agent`（不兼容）：删除只为兼容保留的 `ingressMessages.cleared` 键（清空确认文案只在清空命令里使用）。
- `@zhin.js/core`：别人提问的确认 / 选择按钮被旁人点击时，群里不再回复「交互已过期」（提问仍属于被提问的人，结局 `permission_denied`，原因 `interaction_not_own`）；旁人打字回答本来就不会被当成回答，现有测试锁定。带 `permit` 的按钮被不满足条件的人点击时，群里不再回复「你不能使用这个按钮」，私聊照旧说明。普通插件命令的 `permit` 拒绝回复不变。不新增公共导出。
- `zhin.js`：聊天 `restart` 对非全局主人、以及替别人确认他发起的重启，在群里不回复（审计原因分别为 `not-global-owner` / `confirmation-not-own`）；主人自己的确认过期或参数不对照常提示。`功能` / `角色` 自助在该范围没有 admin、角色不足以授予 / 撤销（`not-admin`、`role-denied`、`owner-denied`、`peer-denied`），或确认码属于别人（新拒绝原因 `confirm-not-own`）时，群里不回复，私聊照旧说明；用法错误、确认码过期等仍回复。不新增公共导出。
