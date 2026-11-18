---
"@zhin.js/agent": patch
---

`pnpm eval:agent` 的 Vitest 配置改为继承根配置的 `exclude`，并只去掉把 `packages/im/agent/evals/**` 挡在 PR 门禁之外的那一条，不再手写一份排除列表。
