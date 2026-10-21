---
"@zhin.js/cli": patch
---

新增 `zhin plugin check [dir]`：在插件目录检查 `package.json` / `zhin.entry` / `files` 白名单 / 约定目录与 prepack 脚本，并默认实际 `npm pack` 后按 `check:pack-imports` 的同一套规则检查发布包（入口与 exports 已打包、相对 import 可解析、无测试与配置、约定目录 `.ts` 均有 `.js`）。支持 `--no-pack`、`--json`、`--strict`。
