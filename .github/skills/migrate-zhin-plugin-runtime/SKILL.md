---
name: migrate-zhin-plugin-runtime
description: Migrate legacy Zhin.js projects and plugins from usePlugin/addCommand/addMiddleware/addComponent and mutable registries to the convention-based Plugin Runtime. Use for breaking upgrades to commands, components, middleware, tools, skills, agents, pages, schema, manifests, plugin trees, HMR, and @zhin.js/runtime. 适用于旧 Zhin 插件向约定式目录与快照运行时的破坏性迁移。
---

# 迁移 Zhin Plugin Runtime

目标是产出纯新架构代码，不保留 compat runtime。先读：

- [迁移映射](./references/migration-map.md)
- 仓库 `docs/architecture/target-implementation/in-place-migration.md`
- 目标包 README 与插件最近的测试

## 工作流

1. 盘点旧插件入口、注册调用、Context、配置、资源、事件与用户可见行为。
2. 运行 `zhin runtime migrate extract --check`，审阅每个 change 和 diagnostic。
3. 对安全项运行 `zhin runtime migrate extract --write`；不要覆盖已有目标文件。
4. 按 diagnostic 逐项迁移闭包和生命周期。共享状态进入 Plugin Resource/Context，能力文件
   只读取注入的 config/resource，运行时回调不得调用 `getPlugin()`。
5. 迁移 `schema.json`、`package.json#zhin`、Feature mounts 和 child Plugin mounts。
6. 运行 `zhin runtime migrate cutover --write`，再运行 `zhin runtime migrate status`。
7. 删除旧注册代码、旧入口和 compat 依赖。用 `rg` 确认没有遗留 API。
8. 构建并运行最小范围测试；对命令路由、消息发送、配置默认值和 HMR 做行为验证。

## 硬性规则

- 不引入 `@zhin.js/next-*` 或 legacy callback adapter。
- 不同时写 RuntimeSnapshot 与旧 registry。
- `usePlugin()`/`getPlugin()` 不得出现在能力执行路径。
- 消息发送必须经过统一 render/send pipeline。
- Command 参数由文件名表达；不要在 metadata 中维护第二套路由。
- Page/TSX 由 Client Build adapter 生成 artifact，Node 不执行作者 TSX。
- 自动迁移无法证明语义等价时，保留 diagnostic 并人工改写，不做猜测性替换。

## 完成标准

```bash
zhin runtime migrate status
rg -n "add(Command|Middleware|Component)|defineLegacy|@zhin.js/next-|getPlugin\\(" .
pnpm --filter <plugin-package> build
pnpm --filter <plugin-package> test
```

`status` 必须为 complete，`rg` 只允许命中文档/迁移测试。记录未能实测的平台行为，不以
“编译通过”替代运行时验证。
