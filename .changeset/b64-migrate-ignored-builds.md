---
"@zhin.js/cli": patch
---

安全相关行为修正（#1250）：`zhin migrate` 不再推翻项目对安装脚本的明确禁止。列在 `ignoredBuiltDependencies` / `neverBuiltDependencies`（`package.json#pnpm` 或 `pnpm-workspace.yaml`；项目位于上层 pnpm workspace 内时也读取根目录的这两个文件）中的包，或 `allowBuilds` 里写成 `false` 的包（含 `ssh2@1.16.0: false` 这类带版本的键），不会被加入 `allowBuilds` 或 `onlyBuiltDependencies`；名单项按包名比较（`ssh2@1.16.0`、带空格的项、标量写法都算，标量写法另给警告），计划中显示「已跳过：在 ignoredBuiltDependencies 中」或「已跳过：在 neverBuiltDependencies 中」，`--dry-run` 与实际执行一致。只有 pnpm 11 的占位值 `set this to true or false` 与空值会改成 `true`，`'false'`、`no` 等其他非布尔值保留并警告。被禁止的包同时在允许名单里时不自动修改，只打印冲突警告（两处位置、pnpm 10 / 11 各按哪处生效）。嵌套 workspace 的提示只列未被拒绝的包。

`zhin update --dry-run` 末尾另列已锁定精确版本（`dependencies` / `devDependencies`，与 `zhin migrate` 一致）、registry `latest` 标签更新的 Zhin 包：显示实际安装版本（未安装显示「未安装」）→ 最新；根项目提示 `zhin migrate --include-pinned`，工作区成员提示「`zhin migrate` 会随根升级」；registry 查询失败时省略该段。

`zhin migrate --include-pinned` 不再把 `npm:` 别名（以及 `link:`、`file:`、git 等非 registry 来源）改写成 `^x.y.z`：这些依赖保留并给出提示。
