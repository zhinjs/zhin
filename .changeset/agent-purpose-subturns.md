---
"@zhin.js/agent": minor
---

子 Agent 用途绑定生效（#1250 `agent-purpose-binding-ignored`）：`ask` / `delegate` 拉起的子回合按 `purposes.agents` 选模型：先查插件限定名（`<plugin>__<agent>`，推荐的键），再查裸名——裸名只在没有其他子 Agent 同名、也不是 Agent 绑定名（`ai.agents.<name>`，与绑定共用同一键空间）时才用；子 Agent 永远不会用到绑定的用途，有歧义时写 warn 并回退聊天用途；汇总回合（入口 Agent）沿用主回合的用途（包括非 zhin 绑定的 `agent:<binding>`）和候选模型链。「绑定名」只算 `ai.agents` 里配置的绑定，仅从 agent 文件发现的名字不算。走聊天用途的子回合保留主回合的候选模型链。子回合 trace 的 `model_selection` 写出实际用的用途、profile、账号与模型。`ModelDelegationAuthority.acquire` 与 `ModelContextAcquireInput` 新增可选 `agent` 字段（`SubAgentModelKey`），`ModelRuntimeServiceOptions` 新增可选 `bindingNames`（类型 `SubAgentModelKey` 由 `@zhin.js/agent/model-runtime` 导出）。
