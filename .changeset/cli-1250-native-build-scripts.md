---
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

网关原生依赖的构建脚本（#1250）：pnpm 10+ 默认跳过依赖的构建脚本（pnpm 11 直接让安装失败），`node-pty` 装上却无法加载，Console 本地终端不可用。`create-zhin-app` 生成的 `pnpm-workspace.yaml` 现在在 `allowBuilds` 中放行 `node-pty`、`ssh2`、`cpu-features`（pnpm 11 不再读取 `package.json` 的 `pnpm` 字段，`onlyBuiltDependencies` 也被忽略）；`zhin migrate` 为声明了 `@zhin.js/gateway` 的 pnpm 项目补齐这些条目（已有条目保留、`false` 不改，空的 `allowBuilds:` 也能补齐，已有的 `onlyBuiltDependencies` 列表同样追加，不重排文件中的长字符串；`--dry-run` 只预览）；项目没有 `pnpm-workspace.yaml` 时，只有确认使用 pnpm 10+（`packageManager` 为 pnpm 10 及以上，或 `pnpm --version` ≥ 10）才会创建它——只含 `allowBuilds` 的该文件会让 pnpm 9 报 `packages field missing or empty`，而 pnpm 9 本来就会运行依赖构建脚本，此时只打印提示；项目位于上级目录的 pnpm workspace 内时（向上查找到文件系统根或用户主目录为止）也不在项目中创建该文件（否则它会变成独立的 workspace 根），而是提示把 `allowBuilds` 条目加到上级的 `pnpm-workspace.yaml`；`zhin doctor` 在项目目录的子进程中加载网关的 `node-pty`，失败时警告并给出修复命令，未安装网关时跳过。
