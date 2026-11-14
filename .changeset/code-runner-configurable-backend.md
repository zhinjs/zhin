---
"@zhin.js/plugin-code-runner": minor
---

code-runner：后端改为可配置（`provider` piston / glot、`endpoint`、secret 字段 `token`，支持 `${ENV}` 引用），不再写死已 404 的 glot.io 地址；未配置时回复「未配置代码运行后端，请在配置里设置 endpoint」而不发请求。新增语言别名（js、ts、py、sh、c++/cpp、rb、golang 等）与 bash；`run js …` 不再报「language：值不正确」。（#1250）
