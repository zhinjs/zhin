---
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

网关原生依赖的构建脚本（#1250）：pnpm 10+ 默认跳过依赖的构建脚本（pnpm 11 直接让安装失败），`node-pty` 装上却无法加载，Console 本地终端不可用。`create-zhin-app` 生成的 `pnpm-workspace.yaml` 现在在 `allowBuilds` 中放行 `node-pty`、`ssh2`、`cpu-features`（pnpm 11 不再读取 `package.json` 的 `pnpm` 字段，`onlyBuiltDependencies` 也被忽略）；`zhin migrate` 为声明了 `@zhin.js/gateway` 的 pnpm 项目补齐这些条目（已有条目保留、`false` 不改，已有的 `onlyBuiltDependencies` 列表同样追加；`--dry-run` 只预览）；`zhin doctor` 在项目目录的子进程中加载网关的 `node-pty`，失败时警告并给出修复命令，未安装网关时跳过。
