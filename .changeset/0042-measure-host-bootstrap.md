---
"@zhin.js/agent": patch
---

`AGENTS.md` 去重以本回合系统提示词实际携带的 bootstrap 为准（回合引擎传入），不再读 `host.bootstrapContext`（生产中为空，去重从未生效）。评测新增 `hostBootstrap`，按 CLI 宿主方式把 bootstrap 交给回合引擎，度量与生产一致。
