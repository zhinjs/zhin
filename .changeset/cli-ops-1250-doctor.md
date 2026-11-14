---
"@zhin.js/cli": patch
---

`zhin doctor`（#1250）：「Zhin 包单实例」解析依赖时跳过 pnpm 隐藏提升目录 `node_modules/.pnpm/node_modules`，其中残留的旧版本不再被误报为重复实例；端口被本项目管理网关监听时报 ok，不再建议 kill；Console 已初始化（网关报告，或离线时 `.zhin/console-iam.initialized` 存在）后 `HTTP_TOKEN` 降为提示「初始化后此令牌一律被拒绝，可从 .env 删除」，`--fix` 也不再改写它。`zhin config check` 对 `disable_plugins` 中插件实例配置块里未设置的 `${ENV}` 降为 info。
