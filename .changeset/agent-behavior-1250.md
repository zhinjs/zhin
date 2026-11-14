---
"@zhin.js/agent": minor
---

Agent 行为改进（#1250）：被拒或失败的工具结果以「未执行」开头并写明原因；回合结束时若有未声明 `readOnly` 的写操作被拒 / 失败而回复没有如实说明，框架在回复末尾追加一行说明（只追加、不改写，已流式发出时不追加）。`memory_upsert` 获得独立审批等级：实时回合写发起人自己的 `user` 记忆不再审批，`global` / `platform` / `session` 与无人值守回合仍需审批（策略 `memory-scope`）。拒绝记录带上当时的审批策略指纹，策略变更后会话下一回合注入 `approval-policy-change` 说明，避免模型依据旧拒绝直接放弃。`discover` 的排序器返回空或部分结果时不再丢掉关键词命中（排序结果在前、合并去重）。全局 owner 读过外部内容后的高危动作在 `ask` / `bypass` 下改为向主人本人一次性确认（不记住、超时算拒绝，主人不在场时拒绝），`auto` 仍由审核 Agent 决定。新增 API：`createBypassApprovalPort` 的 `confirmIntent` 选项、`createRuntimeApprovalPort` 的 `masterPresent` 选项、`MEMORY_SCOPE_POLICY`。
