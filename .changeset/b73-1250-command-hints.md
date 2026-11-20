---
"@zhin.js/agent": patch
"zhin.js": patch
---

#1250 第 73 批：审批卡、群规卡与提示里的命令按本账号的真实命令前缀书写，并按收件人的语言输出。

- `@zhin.js/agent`：IM 审批卡（危险工具卡与变更审批卡）、群规预览卡、「Bot 不是管理员」群通知与群规冲突提示不再写死 `/`：卡片按收件 Endpoint 的真实命令前缀拼写 `approve <id>` / `deny <id>` / `rule approve <短码>` / `rule disable <短码>`（与入站解析剥掉的前缀一致，默认无前缀；前缀未知时给裸命令并提示加上本账号的前缀）。这些卡片、通知、`approve` / `deny` 与 `rule …` 的回复按收件人 / 发送者的语言输出中英文，过期时间改用 `YYYY-MM-DD HH:mm:ss`。`formatImApprovalCard()` / `formatSelfChangeCard()` / `formatGroupRuleCard()` 的第 3 / 2 / 3 个参数改为可选的命令呈现（`{ locale?, commandPrefix? }`，仍接受旧的前缀字符串），`formatGroupRuleStage()` / `formatGroupRuleNotice()` 新增可选参数 `locale`；`ImToolApprovalChannelOptions`、`GroupRuleImDeps` 新增可选 `resolvePresentation`，`GroupRuleEffects` 新增可选 `presentation`，`ImApprovalCommandInput` / `GroupRuleCommandInput` 新增可选 `locale`（后者另有 `commandPrefix`），`AgentTurnIngressRouteOptions` 新增可选 `resolveConversationPresentation`；没有新增导出。模型空回复兜底（`formatReplyFallback()` / `formatToolCallsForUser()` 的 `context` 新增可选 `locale`）按回合语言输出英文，`/clear` 是不需要前缀的入口词，保留字面。主人 `approve` 指令的拒绝文案改为指引「在 Console『聊天角色』里给自己授予全局 owner，或私聊发送『认领 <码>』」，不再提已移除的插件配置 master/owner。
- `zhin.js`：实例按当前生成的适配器配置（`commandPrefix`、`endpoints[i].commandPrefix`）与收件人的语言偏好为这些回合外的卡片解析命令呈现；`绑定` / `功能` / `角色` 的用法、翻页与全局确认提示用 `command.formatCommand(...)` 写出带真实前缀的命令（中英文）。
