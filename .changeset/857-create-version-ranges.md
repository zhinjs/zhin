---
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

新建项目写入真实依赖版本范围（如 `zhin.js: ^1.1.11`），不再写 `latest`：范围在 scaffold-wizard 打包时由 `prepack` 从工作区版本生成，AI 栈第三方包沿用 Zhin 自身 peer 范围；拿不到版本的依赖仍保留 `latest`。doctor / config check 诊断基线不变。
