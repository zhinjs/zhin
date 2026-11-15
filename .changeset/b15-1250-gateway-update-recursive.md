---
"@zhin.js/gateway": patch
---

`zhin update`（网关依赖事务）在 pnpm 工作区（`pnpm-workspace.yaml` 列出了 `packages`）里以 `pnpm update -r` 运行，工作区里的本地插件随根目录一起升级（zhinjs/zhin#1250）。
