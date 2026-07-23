# scripts/archive

一次性迁移/修复脚本的历史归档，**不再被任何 npm script 或 harness 引用**，仅保留备查。

- `rename-bot-to-endpoint*.mjs`、`rename-bot-strings-pass4.mjs`、`rename-sendoptions-bot-field.mjs`：`bot` → `endpoint` 命名的多轮 codemod（已完成）。
- `migrate-to-submodules.sh`：子模块迁移（已废弃，见 `docs/contributing/monorepo-no-submodules.md`）。
- `fix-changeset-patch-majors.mjs`、`merge-duplicate-imports.mjs`、`fix-agent-tool-lint.mjs`：一次性修复脚本（已执行完毕）。

新增检查/构建脚本请放在上级 `scripts/` 目录；一次性脚本执行完后移入本目录。
