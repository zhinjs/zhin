---
"@zhin.js/console-contract": patch
"@zhin.js/page": patch
"@zhin.js/pagemanager": patch
"@zhin.js/client": patch
"@zhin.js/contract": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

页面元数据新增可选 `section`（`overview` / `conversations` / `features` / `plugins` / `ops` / `access`，ADR 0052），声明页面在 Console 导航里属于哪个分区；`definePage` 校验取值，Host 的 `/entries` 与客户端 `resolveEntryRegister` 把它透传到路由 `meta.section`，未知值被丢弃。
