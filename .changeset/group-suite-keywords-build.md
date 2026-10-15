---
"@zhin.js/plugin-group-suite": patch
---

修复 1.1.8 发布包缺少 `lib/keywords.js` 导致启动报 `Cannot find module .../lib/keywords.js`：`tsconfig.json` 的 `include` 由手写文件清单改为 `src/**/*.ts`，`keyword-*` 命令与 `keyword-reply` 中间件依赖的 `src/keywords.ts` 现在会被编译进 `lib/`。
