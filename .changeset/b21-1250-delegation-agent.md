---
"@zhin.js/agent": minor
---

委派相关修复（#1250 第 21 批）：
- `agent-purpose-binding-ignored`：给子 Agent 显式绑定的模型优先于适配器 / Endpoint / 场景的聊天覆盖。项目自己的 `agents/<name>/` 与同名 `ai.agents.<name>` 绑定是同一个 Agent，`purposes.agents.<name>` 现在对这个子 Agent 生效（此前被当成「属于绑定」而回退到聊天用途，于是用了 `purposes.adapters.<adapter>.chat`）；插件里同名的子 Agent 仍不拿绑定的键。`purposeKeyEffects()` / `purposeEffects` 对这类键返回 `target: 'binding'` 并在 `agents` 里列出同名的项目子 Agent，`readAgentPurposeTargets()` 把项目子 Agent 标为 `bare`。
- `trace-subagent-calls-doubled`：子 Agent 与 `actor:zhin` 回合的每次模型调用在 trace 里只记一次（之前子回合 trace 与根 journal 各记一次；请求本身没有重复，`agent_usage_calls` 用量行也只记一次）。
- `delegate-budget-self-sabotage`：模型在 `ask` / `delegate` / `follow_up` 里设的预算有下限（`modelCalls` 4、`tokens` 32000、`wallMs` 60000，不超过剩余额度），抬高时在工具结果里说明并记日志；对还没出结果的委派对象再 `ask` 会被拒绝（`delegation_in_progress`），提示等结果或用 `follow_up`；子 Agent 提示要求能直接回答就直接回答，按需工具目录里连续 3 次搜不到（`discover` / `load_tool` / `load_skill`）会提示换办法。
