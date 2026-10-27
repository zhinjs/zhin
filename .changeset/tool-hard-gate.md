---
"@zhin.js/agent": patch
"@zhin.js/tool": patch
"@zhin.js/ai": patch
"@zhin.js/core": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

新增危险工具硬闸（ADR 0036 切片 E，fail-closed）：

- 工具可以声明 `risk: 'dangerous' | 'safe'` 和 `riskCategory: 'member' | 'publish' | 'funds' | 'identity'`。宿主内置一份危险工具清单，`ai.toolHardGate.dangerousTools` 只能把工具调高为危险，插件声明 `safe` 不能调低。
- 危险工具执行前必须拿到一次全新的人工审批（`humanOnly`），`execApprovalMode: bypass`、自动审核、主人自动放行和已记住的授权都不能越过。拒绝、超时（默认 5 分钟）、无人可批都按拒绝处理，本轮不再重试同一工具或同一类别。
- 资金类（`funds`）默认禁用；打开 `ai.toolHardGate.allowFunds` 后仍需审批。
- 无人值守的轮次会排进审批队列，Console 通过 `plugin.root.tool-approvals` 查看、`plugin.root.resolve-tool-approval` 批准或拒绝（权限 `tool_approvals:read` / `tool_approvals:resolve`），批准后下一次同参数调用只放行一次。
- 结果写进 `ai_decision_events`：`tool_hard_gate`（allow / deny）、`tool_approval`（defer / allow / deny），safe / 只读工具放行但仍写 `tool_call`（allow）；新增码 `tool_approval_requested`、`tool_approval_approved`、`tool_funds_disabled`、`tool_hard_gate_latched`、`tool_safe_allowed`（追加在码表末尾）。
