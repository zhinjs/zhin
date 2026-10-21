---
"@zhin.js/scaffold-wizard": patch
---

删除已不再使用的旧版本快照 `src/stack-versions.generated.json`（及仓库脚本 `scripts/sync-scaffold-deps.mjs`）；脚手架版本范围统一由 `stack-version-ranges` 在打包时生成。
