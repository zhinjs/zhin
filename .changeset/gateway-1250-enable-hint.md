---
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

`zhin enable` / `zhin disable`（以及 Console 的插件开关）找不到插件实例时，不再把用户输入拼成 `zhin install <输入>`（#1250）：例如 `zhin enable reminder` 原先提示 `zhin install reminder`，而 npm 上的 `reminder` 是无关的第三方包。现在只从官方目录（目录中的适配器、用途入口的插件）和项目里已安装的 `@zhin.js/*` 包中找名称相近的候选（如 `@zhin.js/plugin-reminder`）；没有候选时只说「找不到插件实例 X（配置中没有声明）」。
