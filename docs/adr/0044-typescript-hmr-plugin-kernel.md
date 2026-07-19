# ADR 0044: TypeScript HMR Plugin Kernel

## 状态

Accepted；全新项目目标架构。

## 决策

Zhin 的底层基础是原生支持 TypeScript/TSX 与 Hot Module Replace 的 Plugin Kernel。

### D1. Plugin instance tree

- Root 与普通 Plugin 使用同一种实例模型。
- 任意 Plugin package 都可以被直接实例化为 Root；Root 是运行时角色，不是特殊包类型。
- Plugin A 可以在静态 package manifest 中声明并加载 B/C，B 可以继续声明 D/E/F；物理 workspace package 仍扁平位于 `plugins/*`。
- 运行时 owner、Resource visibility 与 dispose 由 Plugin 实例树决定，不由 module import graph 决定。

### D2. PluginScope 是能力 seam

- 单值 Resource 通过 Token 提供，并由子 Plugin 向最近祖先查找。
- 多值 Feature contribution 记录 owner，向 Runtime 提供只读 snapshot。
- Environment、EnvStore、ConfigStore、Database 是 Root 提供的基础 Resource。

### D3. TypeScript Module Runtime

- 开发环境直接加载 `.ts` / `.tsx` Plugin 与 Capability definition。
- transpile、source map、JSX runtime 和 module cache 由 Module Runtime 统一处理。
- 生产预编译不改变 Plugin identity 与行为。

### D4. 三层身份

- npm package 是发布身份；一个包根导出一个 canonical Plugin definition。
- Plugin instance 是运行时身份；同一个包可以在 Plugin 树中产生多个实例。
- Capability Slot 是最小热更身份；每个声明文件对应一个 owner-bound、versioned contribution。

### D5. HMR 优先替换 Capability Slot

- Capability 文件变化时，只替换该 Slot。
- Page 文件变化时，只替换对应 client Page Slot，不重载服务端 Plugin。
- `$nav.tsx`、`$footer.tsx` 变化时，只替换对应 client Layout Slot。
- 纯共享模块变化时，按 Module Graph 的反向依赖闭包批量替换受影响 Slot。
- Slot 批次在 shadow transaction 中完成 compile、import、parse 和 validate，再由 RootController 以一个 generation 原子提交 Feature projection。
- Runtime 租用 immutable snapshot；旧 generation 在所有 in-flight lease 释放后 dispose。
- 局部状态随 Slot generation 销毁；持久状态必须放入 Resource。

### D6. 越过 Plugin seam 时替换子树

- 文件必须可映射到 owning Plugin instance。
- `plugin.ts`、setup 依赖或 Resource provider 变化时，不进行 Slot 替换。
- `package.json#zhin.plugins` 或 `package.json#zhin.features` 变化时，重新解析 package graph 并替换受影响子树。
- `schema.json` 或 Plugin 自身配置变化时，重新校验并替换该 Plugin 子树。
- 变化 Plugin 及其后代构成替换子树。
- 新子树先在 shadow scope 中 compile、setup 和校验。
- 成功后原子替换 Resource、Feature contribution 和 child reference。
- 失败时旧子树继续运行。
- dispose children-first，setup parent-first，ready children-first。

### D7. 无模块级注册副作用

Plugin 与 Capability 模块默认导出纯 definition。能力只能通过 PluginScope 发布，并必须返回 disposer。

## 开发模式实现

`ModuleRuntime` 是可替换 adapter。开发实现必须独立于默认生产闭包，并提供：

- `SourceOwnershipIndex`：source file -> package -> Plugin instance -> Capability Slot。
- `InvalidationPlanner`：反向依赖闭包与 Slot/subtree/process 升级判定。
- `CapabilityTransaction`：shadow load、definition validation、`replaceMany` compare-and-swap。
- `SnapshotLease`：让进行中的消息或 Agent turn 安全完成后再释放旧 generation。

生产模式使用预编译 ESM adapter，不启动 watcher。入口 query-string cache busting 不是目标实现，因为它不能完整管理传递依赖失效和旧 module generation。开发 adapter 单独执行 ≤2.5MB 安装预算，禁止引入与服务端 TS transform 无关的 CSS/前端构建依赖和大型 native binary。

## 基础 Resource 语义

- RuntimeEnvironment：显式 mode/platform，不散落读取全局环境判断。
- EnvStore：schema、secret 与缺失诊断。
- ConfigStore：共享存储、按 Plugin id 建立 namespace。
- Database：共享连接池与事务，向 Plugin 提供 owner-scoped view。

## Runtime 关系

IM、Agent、Schedule 等 Runtime 是 PluginScope snapshot 的消费者，不是 Plugin 装载器，也不拥有第二份能力注册源。

## 参考

- [Plugin-first 目标架构](../target-architecture.md)
- [ADR 0043](./0043-unify-capability-roots.md)
- [Node.js `vm.SourceTextModule`](https://nodejs.org/api/vm.html#class-vmsourcetextmodule)
- [ADR 0047](./0047-standalone-plugin-and-root-lifecycle-domain.md)
- [ADR 0048](./0048-plugin-monorepo-and-feature-provider-packages.md)
