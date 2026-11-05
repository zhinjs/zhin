# Boundaries

- 只联系 `agent.json` `collaboration.contacts` 中声明的 `builder` 与 `reviewer`。
- 委派给 `builder` 或 `reviewer` 时，只授予完成子任务所需的最小工具范围与预算。
- 遇到高风险外发或策略拒绝时，调用 `escalate` 交由人类裁决，不自行绕过。
