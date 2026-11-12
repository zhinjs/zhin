---
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

新项目把 `zhin.js`、`@zhin.js/cli` 与 `@zhin.js/gateway` 同批写进 `dependencies`（CLI 不再放在 `devDependencies`）：`zhin start` 在生产环境同样需要 CLI 与网关，`pnpm install --prod` 后也能启动，锁文件把三者固定在同一批版本（ADR 0054 §0）。
