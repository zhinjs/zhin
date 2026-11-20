---
"@zhin.js/agent": minor
"@zhin.js/command": patch
"@zhin.js/core": patch
"zhin.js": patch
---

#1250 第 75 批：群里无权限者发确认 / 审批 / 管理类命令时，机器人不回复、不执行，避免旁人乱操作刷屏；私聊照旧回复无权限原因，有权限的人操作出错（确认码过期、格式不对等）照常提示。这些拒绝都记为入站结局 `permission_denied`（群里 `reply: no`，私聊 `reply: yes`），Console「消息结局」可查；原有审计照常写。

- `@zhin.js/agent`：Agent 管理命令（`models`、`tree`、`fork`、`compact`、`reset`、`ai.health`）对非主人 / 受信任用户、审批卡命令 `approve <id>` / `deny <id>` 对不在审批人名单且不是能结算该自我变更卡的全局主人、主人命令 `approve …` 对非全局主人（全局主人在群里发仍提示改用私聊）、群规命令 `rule approve|reject|disable …` 对非群管理员 / 非审批人：在群聊与频道里不回复，消息在入站管理阶段终止，不会再进入 AI 回合（模型不会代为回答「没有权限」）；私聊回复不变。群规命令在频道等非群会话、或群规不可用时也先判审批人：非审批人静默，只有审批人收到「只能在对应的群里用」「群规不可用」。`rules` 列表、`memory` / `forget` 仍对所有人开放。`RuntimeManagementDeps`、`ImApprovalCommandInput`、`GroupRuleCommandInput`、`OwnerApprovalCommandContext` 新增可选回调 `onUnauthorized(reason)`：处理器在回复是「无权限拒绝」时调用它（返回的文案不变），由入站阶段决定群里静默、私聊回复。
- `@zhin.js/agent`（不兼容）：删除只为兼容保留的 `ingressMessages.cleared` 键（清空确认文案只在清空命令里使用）。
- `@zhin.js/core`：别人提问的确认 / 选择按钮被旁人点击时，群里不再回复「交互已过期」（提问仍属于被提问的人，结局 `permission_denied`，原因 `interaction_not_own`）；旁人打字回答本来就不会被当成回答，现有测试锁定。带 `permit` 的按钮被不满足条件的人点击时，群里不再回复「你不能使用这个按钮」，私聊照旧说明。提问结束后 10 分钟内（最多记 512 个按钮）仍记得它是问谁的：旁人在群里点已结束提问的按钮也不再回复「交互已过期」，被提问的人自己点仍提示过期，记录过期或被挤掉后按原样提示。插件命令的 `permit` 不满足、且不满足的是对发送者的条件（zhin 角色、`platform:*` / `platform-role:*` / `platform-permission:*`、`user(…)`、插件自定义 permit）时，群聊 / 频道里不再回复「没有权限执行此指令」（也不调用自定义命令反馈渲染器），结局 `permission_denied` 记 `reply: no`；场合条件（`private()`、`group()` 等）与机器人自身条件（`bot:*`）照常回复，例如 `config` 在群里仍对所有人回复。不新增公共导出。
- `@zhin.js/command`：命令被拒时，若最先不满足的是场合或机器人条件、而发送者也不满足某个对发送者的条件，拒绝结果改为指名后者（`denial.permit`），使群里对无权限者静默；例如 group-suite 的 `teach`（`group()` + `trusted`）被不受信任的人在私聊里发时，回复改为说明需要 zhin 角色。
- `zhin.js`：聊天 `restart` 对非全局主人在群里不回复（审计原因 `not-global-owner`）；另一位全局主人替别人确认他发起的重启时，审计与结局原因记 `confirmation-not-own`，但他有权限，群里照常提示「没有待确认的重启」；主人自己的确认过期或参数不对照常提示。`功能` / `角色` 自助在任何范围都没有 admin 时先按 `not-admin` 拒绝（`角色` 的用法错误、找不到人等格式类拒绝不再在群里回复无权限旁人），该范围没有 admin、角色不足以授予 / 撤销（`not-admin`、`role-denied`、`owner-denied`、`peer-denied`），或确认码属于别人（新拒绝原因 `confirm-not-own`；确认者本身是全局 admin 时照常提示）时，群里不回复，私聊照旧说明；有 admin 的人的用法错误、确认码过期等仍回复。不新增公共导出。
