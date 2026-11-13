---
"@zhin.js/cli": patch
---

新增 `zhin add <command|middleware|handler|tool|component> <name>`：在当前插件包生成约定目录能力文件（`commands/<path>/index.ts`、`middlewares/<name>/index.ts`、`handlers/<path>/index.ts`、`tools/<name>/index.ts`、`components/<name>/index.tsx`），模板是能通过类型检查的最小默认导出；同时在 `package.json#zhin.features` 声明对应 Feature 包，插件尚未依赖时按 `zhin new` 的规则写进可选 `peerDependencies` 与 `devDependencies`。已存在的文件默认不覆盖（`--force` 覆盖），名称每段需匹配 `/^[a-z][a-z0-9-]*$/`（命令末段可为 `[param]`），`--cwd` 指定插件目录，`--event` 指定 handler 事件。第一个参数不是能力类型时，`zhin add <包名>` 照旧按 `zhin install` 安装，并提示改用 `zhin install`。
