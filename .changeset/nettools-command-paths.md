---
"@zhin.js/plugin-nettools": patch
---

修复 `dns` 与 `domain-price` 指令无法加载（#1250）：两者用了两层参数目录（`dns/[name]/[[type]]`、`domain-price/[suffix]/[[order]]`），违反「只有最后一层目录可以是参数目录」，运行时加载抛 `CommandPathSyntaxError`。现改为单层参数目录（`dns/[name]`、`domain-price/[suffix]`），第二个参数在 `defineCommand({ params })` 里声明为可选；`dns example.com MX`、`domain-price com renew` 写法不变。
