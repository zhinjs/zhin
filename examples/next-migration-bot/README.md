# Next Migration Bot

`next-migration-bot` 是 Zhin 4.x 到 Next 架构的可执行双版本追踪样例，不是新项目模板。新项目仍应从 `examples/minimal-bot` 开始。

## 覆盖范围

- `legacy/hello.ts` 保留旧版 `MessageCommand`，作为迁移前基线。
- `commands/hello/[name:string].ts` 使用 convention 路由和 `defineLegacyCommand()` 保留旧 callback 形状。
- `middlewares/audit.ts` 使用 `defineLegacyMiddleware()` 进入 Middleware Feature。
- `components/status-card.ts` 使用原生 `defineComponent()`，不再依赖 Plugin 注册副作用。
- `package.json#zhin` 同时声明三个 Feature provider，是 cutover 后的静态拓扑事实源。

## 验证

```bash
pnpm --filter @zhin.js/example-next-migration-bot build
pnpm --filter @zhin.js/example-next-migration-bot test
```

测试对同一条消息分别执行旧 `MessageCommand` 与迁移后的 Command definition，并断言返回值一致。它还执行迁移后的 middleware 和 component，避免样例退化成只能编译、不能运行的静态文件。

## 迁移顺序

在待迁移项目中先预检，再分两次显式提交：

```bash
zhin-next migrate --check
zhin-next migrate --write
zhin-next migrate cutover --check
zhin-next migrate cutover --write
```

第一阶段只提取无外部闭包的 Command、Middleware 和 Component。第二阶段生成 `plugin.next.ts` 并提交 `package.json#zhin`；旧入口和旧源码不会被删除，因此业务行为可以在真正切换启动器前持续对照。
