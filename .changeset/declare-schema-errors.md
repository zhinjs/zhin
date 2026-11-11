---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
---

`schema:get` 支持按包名读取已安装但未声明插件的 Schema（返回 `declared: false`）；`gateway.plugins.declare` 校验失败时返回结构化 `errors`（`path` / `message`）与 `missingEnv`，提示文字保持不变。
