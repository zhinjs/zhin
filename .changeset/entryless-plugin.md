---
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
"@zhin.js/testing": patch
---

插件包可以省略 `plugin.ts`：`type: "plugin"` 的清单既不写 `zhin.entry` 也不写 `exports["./zhin"]` 时，清单记录为无入口，运行时（普通与隔离加载路径）按 `definePlugin({ name: <去掉 scope 的包名> })` 装配，约定目录照常从包根目录发现。包名去掉 scope 后不符合 `/^[a-z][a-z0-9-]*$/` 时启动报错并提示添加带显式 `name` 的 `plugin.ts`。Feature 包仍必须声明入口，已声明但不存在的入口仍然报错。`zhin plugin check`、`check:plugin` 与网关插件安装检查接受无入口插件；`zhin plugin check` 对存在 `plugin.ts` 却未声明入口的情况给出警告。`@zhin.js/testing` 的测试应用根仍需声明入口（用于挂载测试端点），缺失时给出明确错误。

`package.json#zhin.features` 可以省略：省略时运行时按包根目录下存在的约定目录（`commands/` → `@zhin.js/command`、`tools/` → `@zhin.js/tool` 等，映射表 `CONVENTION_FEATURE_PACKAGES` 由 `@zhin.js/runtime` 统一导出）推断要挂载的 Feature 包；推断出的引用不带 `api` 范围，找不到时报与显式声明缺失相同的 `PackageResolutionError` 并写明是哪个目录推断出来的。写了 `features`（包括 `[]`）的插件不做推断，行为不变；隔离插件不推断；Root 继承的 Stable Features 优先。最小插件清单为 `"zhin": { "protocol": 1, "type": "plugin" }`。`zhin plugin check` 要求推断出的 Feature 已声明为依赖，`zhin add` 在省略 `features` 时不再写出 `features` 列表，网关卸载检查与仓库依赖检查同样计入推断出的 Feature。
