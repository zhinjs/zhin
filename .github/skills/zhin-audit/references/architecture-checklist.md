# 架构检查清单

## 依赖方向

- [ ] 以 `docs/concepts/architecture.md` 与各包 `package.json` 为准，运行 `pnpm check:architecture` 和 `pnpm check:domain-module-boundaries`。
- [ ] `plugin-runtime → feature-kit → Feature packages`；Feature 包不反向依赖 Core。
- [ ] `im-contract` 保持传输中立；kernel 与 ai 不引入 Adapter、Endpoint、Message 等 IM 概念。
- [ ] `basic/cli` 是唯一 composition root；低层包不直接装配 Host 或上层实现。

## Plugin Runtime 与 Resource

- [ ] 生产代码没有恢复 `usePlugin()`、`getPlugin()`、`createGenerationStore` 或模块级 latest-value stack。
- [ ] `plugin.ts` 只做装配；能力位于 `<kind>/<name>/index.ts(x)` 并 default-export 单一定义。
- [ ] setup 通过 `context.resources` provide/use；能力通过执行上下文的 `context.use(token)`。
- [ ] listener、timer、route、socket、Host registration 都有 generation-owned disposer。
- [ ] 运行 `pnpm check:no-removed-plugin-api`、`pnpm check:plugin-runtime-api` 与相关 authoring boundary 门禁。

## Adapter 与消息链

- [ ] 新适配器遵循 `defineAdapter({ capabilities, create })` 与 `{ client, connect, activate?, send }` 契约。
- [ ] `connect({ events, signal, onCleanup })` 在取得资源时立即登记清理；入站用 `events.message()` 投影。
- [ ] WS/SSE、重连与心跳使用 `createEndpointLifecycle`，并通过 `pnpm check:adapter-endpoint-boundaries`。
- [ ] 出站仍经过 `renderSendMessage → before.sendMessage → AdapterIndex/Endpoint`；运行 `pnpm check:harness-paths`。

## 配置、Console 与发布

- [ ] 插件字段在 `schema.json` 声明，并由 `context.config.get()` 读取。
- [ ] Console 页面位于 `pages/<name>/index.tsx`，默认导出组件并导出静态 `meta`。
- [ ] 发布包包含实际存在且已编译的能力目录；运行 `pnpm check:plugin-capability-publish`。
- [ ] 本地相对导入使用 `.js` 后缀；Node 源码/产物为 `src/` / `lib/`，浏览器侧为 `client/` / `dist/`。
