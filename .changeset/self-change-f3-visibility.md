---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Self-change approval visibility (#1142, ADR 0040 F3): `buildSelfChangeDetailDiff` / `selfChangeDiffExcerpt` / `skippedTrialChecks` in `@zhin.js/agent`; self-change approval cards now carry a bounded diff excerpt (≤ 40 lines / 2 KB) and the skipped check names, also after `restore()`. The CLI host adds the `plugin.root.self-change-detail` Console RPC (`ops:approve` only: per-file unified diff ≤ 64 KB, redacted config values, full trial checks) and shows the excerpt plus a blind-approval warning on the IM card; `plugin.root.tool-approvals` drops the excerpt from its read-only list.
