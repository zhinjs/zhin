---
"@zhin.js/agent": minor
---

Agent 行为改进（#1250）：被拒或失败的工具结果以「未执行」开头并写明原因；回合结束时只要有未声明 `readOnly` 的写操作被拒 / 失败，框架一定补一行按操作类别写的固定说明（如「（提醒、记忆等操作未执行）」，不再按关键词猜测回复是否已说明）：回复未发出时追加在末尾，已流式发出时经正常出站链单独补发一条；追加 / 补发 / 补发失败记入回合追踪 `unexecuted_tool_notice`。`memory_upsert` 获得独立审批等级：实时回合写发起人自己的 `user` 记忆不再审批，`global` / `platform` / `session` 与无人值守回合仍需审批（策略 `memory-scope`）。拒绝记录带上当时的审批策略指纹，策略变更后会话下一回合注入 `approval-policy-change` 说明，避免模型依据旧拒绝直接放弃。`discover` 的排序器返回空或部分结果时不再丢掉关键词命中（排序结果在前、合并去重）。全局 owner 读过外部内容后的高危动作在 `ask` / `bypass` 下改为向主人本人一次性确认（不记住、超时算拒绝，主人不在场时拒绝），`auto` 仍由审核 Agent 决定。新增 API：`createBypassApprovalPort` 的 `confirmIntent` 选项、`createRuntimeApprovalPort` 的 `masterPresent` 选项、`MEMORY_SCOPE_POLICY`。
