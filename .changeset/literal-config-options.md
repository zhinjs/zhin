---
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-short-url": patch
---

补齐 Host 配置字段定义与未配置区块入口，完整投影对象、字典、联合、元组和本地引用，避免 Console 丢字段或整份退回源码。原始 Runtime Schema 继续负责校验。日历、提醒、复读和短链接发布静态配置定义，禁用时也可安全配置，无需执行插件代码。
