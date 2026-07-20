# Plugin Runtime Migration Bot

`plugin-runtime-migration-bot` 是旧 Zhin Plugin 到正式 Plugin Runtime 的可执行行为追踪样例，不是新项目模板。新项目仍应从 `examples/minimal-bot` 开始。

## 覆盖范围

- `legacy/hello.ts` 保留旧版 `MessageCommand`，作为迁移前基线。
- `commands/hello/[name:string].ts` 使用 convention 路由和原生 `defineCommand()`。
- `middlewares/audit.ts` 使用原生 `defineMiddleware()` 进入 Middleware Feature。
- `components/status-card.ts` 使用原生 `defineComponent()`，不再依赖 Plugin 注册副作用。
- `package.json#zhin` 同时声明三个 Feature provider，是 cutover 后的静态拓扑事实源。

## 验证

```bash
pnpm --filter @zhin.js/example-plugin-runtime-migration-bot build
pnpm --filter @zhin.js/example-plugin-runtime-migration-bot test
pnpm --filter @zhin.js/example-plugin-runtime-migration-bot start -- --once
```

测试对同一条消息分别执行旧 `MessageCommand` 与迁移后的 Command definition，并断言返回值一致。它还执行迁移后的 middleware 和 component，避免样例退化成只能编译、不能运行的静态文件。

`start -- --once` 使用 Node 原生 TypeScript 启动真实 Root，读取 `config.yml`，装载三个 Feature provider，发现三个 capability，提交 generation 后再优雅停止。Node 22.6–22.17 由 CLI 自动附加官方 `--experimental-strip-types`；Node 22.18+ 直接运行。

## 迁移顺序

在待迁移项目中先预检，再分两次显式提交：

```bash
zhin runtime migrate extract --check
zhin runtime migrate extract --write
zhin runtime migrate cutover --check
zhin runtime migrate cutover --write
```

第一阶段只提取无外部闭包的 Command、Middleware 和 Component。第二阶段生成正式 `plugin.ts` 并提交 `package.json#zhin`。确认行为后删除旧入口和旧源码；运行时不提供兼容层。
