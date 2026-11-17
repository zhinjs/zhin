---
"@zhin.js/agent": patch
---

修复 nightly 真模型评测找不到 `nightly.run.ts`：nightly 的 Vitest 配置继承了根配置里用于把 `packages/im/agent/evals/**` 挡在 PR 门禁之外的 `exclude`，而 Vitest 里 exclude 优先于 include。nightly 配置现在去掉这一条，其余排除项保持不变。
