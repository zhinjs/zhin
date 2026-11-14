---
"create-zhin-app": patch
"@zhin.js/scaffold-wizard": patch
---

创建项目时 `pnpm install` 以非零状态退出、但 `package.json` 里的依赖都已装进 `node_modules`（pnpm 11 跳过依赖构建脚本时就是这样，`ERR_PNPM_IGNORED_BUILDS`）时，不再打印笼统的「创建项目失败」并以 1 退出：改为说明 pnpm 跳过了哪些包的构建脚本（读 pnpm 写在 `allowBuilds` 里的 `set this to true or false` 占位值）与修复办法，然后继续自检并打印 Console 链接（#1250）。
