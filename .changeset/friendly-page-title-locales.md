---
"@zhin.js/console-contract": patch
"@zhin.js/page": patch
"@zhin.js/pagemanager": patch
"@zhin.js/contract": patch
"@zhin.js/client": patch
"@zhin.js/adapter-sandbox": patch
---

为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
