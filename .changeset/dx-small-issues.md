---
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
"create-zhin-app": patch
---

`zhin doctor` 的端口占用提示不再建议 `kill -9`，改为正常停止或 SIGTERM；缺少 `@zhin.js/tool` 时报错直接给出 `pnpm add @zhin.js/tool`；脚手架生成的 `.gitignore` 加入 `.zhin/`。
