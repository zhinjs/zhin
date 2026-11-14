---
"@zhin.js/agent": minor
---

子 Agent 用途绑定生效（#1250 `agent-purpose-binding-ignored`）：`ask` / `delegate` 拉起的子回合按 `agent:<agent 名>` 用途选模型（Console「AI 与模型 → 用途 → Agent」保存的 `purposes.agents.<name>`），未配置时才回退到聊天用途；汇总回合（入口 Agent）沿用主回合的用途。子回合 trace 的 `model_selection` 写出实际用的用途、profile、账号与模型。`ModelDelegationAuthority.acquire` 与 `ModelContextAcquireInput` 新增可选 `agent` 字段。
