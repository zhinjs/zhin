---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
'@zhin.js/runtime': patch
'@zhin.js/cli': patch
---

master 私聊审批改为先问人：`masterShell: isolated` 不再把审批强制成 `auto`，新增 `ai.agent.masterShellApprovalMode`（默认 `ask`，可选 `auto` / `inherit` 沿用 `execApprovalMode`）；master 私聊中自动审核拒绝会转问 master；群管冷却不再作用于私聊；拒绝提示与安全提示词要求在 master 私聊里请求批准而不是放弃。
