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

- [ ] `defineAdapter({ capabilities, createAdapter })` 创建所属 Adapter，Endpoint 继承真实 SDK／实质协议 Client，并通过 `endpointSpec` 实现结构规范。
- [ ] 原生完整回调由 `events.run` 跟踪；消息由 `events.message` 投影。Adapter 持有账号状态，实际 Client 持有 IO／pending 请求，清理由所属实例负责。
- [ ] WS/SSE、重连与心跳使用 `createEndpointLifecycle`，并通过 `pnpm check:adapter-endpoint-boundaries`。
- [ ] 出站仍经过 `renderSendMessage → before.sendMessage → AdapterIndex/Endpoint`；运行 `pnpm check:harness-paths`。

## 相关模块的设计质量

- [ ] 闭包捕获具体 operation／连接代次；长生命周期工作有对应取消与释放，不在执行时重查“最新 Client”。
- [ ] 参数按实际职责组织；位置参数过多时检查数据、依赖和权限是否混杂，不机械套 `options` 或增加全仓数量门禁。
- [ ] 基类拥有共同不变量，子类只实现真实变化点；包装端口保留原型方法、原始 receiver 和平台类型推断。
- [ ] 持久地址保留完整 Endpoint／parent／thread；账号选择器、稳定身份和执行租约不互相替代。方案见 `docs/plans/adapter-operation-contracts.md`，待设计不得当成已实现保证。

## 配置、Console 与发布

- [ ] 插件字段在 `schema.json` 声明，并由 `context.config.get()` 读取。
- [ ] Console 页面位于 `pages/<name>/index.tsx`，默认导出组件并导出静态 `meta`。
- [ ] 发布包包含实际存在且已编译的能力目录；运行 `pnpm check:plugin-capability-publish`。
- [ ] 本地相对导入使用 `.js` 后缀；Node 源码/产物为 `src/` / `lib/`，浏览器侧为 `client/` / `dist/`。
