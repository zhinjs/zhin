---
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-qrcode": patch
---

发布包补上 `lib/*.d.ts`：`package.json` 的 `types` 指向 `./lib/index.d.ts`，但 `tsconfig.json` 关闭了 `declaration`，TypeScript 使用者拿不到类型。
