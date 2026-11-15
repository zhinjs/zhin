---
"@zhin.js/console-contract": minor
"@zhin.js/page": minor
"@zhin.js/pagemanager": minor
"@zhin.js/contract": patch
"@zhin.js/client": patch
"zhin.js": patch
---

`definePage()` 新增 `keywords`（ADR 0063 决策 3）：命令面板搜索别名，可以是一组，也可以按 `zh-CN` / `en` 分语言（例如 `{ 'zh-CN': ['抽奖'], en: ['lottery'] }`）；`definePage` 校验并去重，`@zhin.js/page` 原样透传。`keywords` 和 `section` 走同一路径：register 包装与 `@zhin.js/client` 的 `resolveEntryRegister` 写进路由 `meta.keywords`，Host 的 `/entries` 在每条 entry 顶层与 `meta` 中都带上 `keywords`；每条 entry 另带所属插件的 `packageName` 和 `pluginDescription`（插件 package.json 的 `description`），供 Console 命令面板按插件名与说明搜索插件页面。
