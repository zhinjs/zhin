---
"zhin": patch
---

`npx zhin` 现在优先使用当前工作目录项目自己安装的 `@zhin.js/cli`（从 `process.cwd()` 解析），找不到时才回退到 shim 自身依赖的版本，避免运行与项目锁定版本不一致的 CLI。
