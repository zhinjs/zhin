---
"@zhin.js/cli": patch
---

安全相关行为修正（#1250）：`zhin migrate` 不再推翻项目对安装脚本的明确禁止——在 `ignoredBuiltDependencies`（`package.json#pnpm` 或 `pnpm-workspace.yaml`，含旧写法 `neverBuiltDependencies`）中列出的包（如 `ssh2`、`cpu-features`）不会被加入 `allowBuilds` 或 `onlyBuiltDependencies`，计划中显示「已跳过：在 ignoredBuiltDependencies 中」，`--dry-run` 与实际执行一致。`zhin update --dry-run` 末尾另列已锁定精确版本、registry 上有更新版本的 Zhin 包（当前 → 最新），并提示用 `zhin migrate --include-pinned` 升级；registry 查询失败时省略该段。
