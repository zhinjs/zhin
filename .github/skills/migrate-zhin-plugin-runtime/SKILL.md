---
name: migrate-zhin-plugin-runtime
description: Migrate legacy Zhin.js plugins and projects to the convention-based Plugin Runtime — from usePlugin/getPlugin/addCommand/addMiddleware/addComponent/addTool/addCron/declareConfig/useContext and mutable registries to definePlugin + capability directories + Scope/Token resources. Use this whenever a Zhin plugin fails to load under `zhin runtime start`, errors with "does not default-export a Plugin definition", still imports zhin.js/@zhin.js/core/@zhin.js/kernel, or when asked to upgrade, port, modernize, or migrate a Zhin plugin, command, middleware, component, tool, cron job, config schema, or package manifest — even if the user does not say the word "migrate". 适用于旧 Zhin 插件向约定式目录与快照运行时的破坏性迁移。
---

# 迁移 Zhin Plugin Runtime

目标是产出**纯新架构代码**：`plugin.ts` 只做装配，能力按目录发现，共享状态走 Resource/Token。
不保留 compat runtime，不双写。

## 先建立事实，再动手

迁移最容易翻车的地方是凭印象改代码。`zhin runtime migrate status` 会静态分析整个项目并
返回一个**状态机**，它比任何猜测都准 —— 每一步都以它的输出为准：

```bash
zhin runtime migrate status        # 输出 JSON；state 为 ready 时退出码 0，否则 1
```

| state | 含义 | 下一步 |
|---|---|---|
| `blocked` | 有 `error` 或 `manual` 诊断，自动迁移无法证明语义等价 | 人工清掉诊断，见 [人工诊断处理](./references/manual-diagnostics.md) |
| `extraction-required` | 还有能自动搬运的注册（`automatic > 0`） | `zhin runtime migrate extract --write` |
| `cutover-required` | 能力已就位，但 `package.json#zhin` / `plugin.ts` 还没生成 | `zhin runtime migrate cutover --write` |
| `dual-run` | 仍在 import `zhin.js` / `@zhin.js/core` / `@zhin.js/kernel` | 删掉旧入口与旧 import |
| `compat` | 仍在 import `@zhin.js/next-compat` | 移除 compat 依赖 |
| `ready` | 完成 | 跑构建与测试 |

状态是**从上往下**判定的：只要还有 manual/error 诊断就一直是 `blocked`，先清诊断再谈其它。

## 工作流

1. **盘点**：读目标包的 README、最近的测试、旧入口，弄清用户可见行为（命令、消息、定时、
   持久化）。迁移的验收标准是行为不变，不是编译通过。
2. **看计划**：`zhin runtime migrate extract --check`，逐条读 `changes` 与 `diagnostics`。
   `--check` 与 `--write` 必须二选一，同时给或都不给会直接报错。
3. **搬能力**：`zhin runtime migrate extract --write`。它只搬**模块顶层、且闭包干净**的注册，
   已存在的目标文件不会被覆盖。
4. **清诊断**：每条 `manual` 都要人工处理，见 [人工诊断处理](./references/manual-diagnostics.md)。
   最常见的是 action 捕获了模块级变量 —— 把它提升为 owner Resource，能力文件再从执行上下文读。
5. **装配**：`zhin runtime migrate cutover --write` 生成 `package.json#zhin` 与 `plugin.ts`，
   并补齐 `@zhin.js/plugin-runtime`、`@zhin.js/runtime` 以及按能力所需的
   `@zhin.js/command|middleware|component` 依赖。启动脚本统一是
   `zhin runtime start`，不要再写失效的 `zhin dev` / `zhin start` / `zhin build`。
   - `package.json#private: true` 的本地 TS root 使用 `entry: "./plugin.ts"`，直接执行
     `pnpm dev` 或 `zhin runtime start`。
   - 非 private 的发布包使用 `entry: "./plugin.js"`；cutover 生成独立的
     `tsconfig.zhin.json`、`zhin:build` 与 `prepack` / `prepublishOnly`，以便 `pnpm pack`
     和 npm publish 前把 `plugin.ts`、约定目录和 `src/` 编译成可发布 JS。不要把
     `plugin.ts` 作为发布 manifest 的入口。
   已有合法 manifest 会被补齐到相应模式；其它 `zhin` 字段形态仍需人工处理。
6. **迁移剩余配置**：`schema.json`（只声明本包字段）、Feature mounts、child plugin mounts。
7. **删旧**：删掉旧注册代码、旧入口、compat 依赖。
8. **验证**：构建 + 测试 + 行为验证（命令路由、消息发送、配置默认值、热更新）。

第 2–5 步之间反复跑 `status` 是最省事的做法 —— 它会告诉你还差什么。

## 目标写法

`plugin.ts` 只装配；能力一个文件一个，default export。完整对照见
[迁移映射](./references/migration-map.md)。

```ts
// plugin.ts
import { createToken, definePlugin, databaseHostToken } from 'zhin.js/plugin-runtime';

export const storeToken = createToken<Store>('my-plugin.store');

export default definePlugin({
  name: 'my-plugin',                       // /^[a-z][a-z0-9-]*$/
  setup(context) {
    // Host 资源都是可选的：先 has 再 use，否则精简安装会装配失败
    if (!context.resources.has(databaseHostToken)) return;
    const db = context.resources.use(databaseHostToken);
    context.resources.provide(storeToken, createStore(db));
    return () => { /* disposer；HMR 回滚时调用 */ };
  },
});
```

```ts
// commands/profile.ts —— 文件路径即路由；参数写在文件名里
import { defineCommand } from 'zhin.js/command';
import { storeToken } from '../plugin.js';

export default defineCommand({
  description: 'Show current user profile',
  async execute(context) {
    const store = context.use(storeToken);   // 能力上下文直接 use，不 import 单例
    return store.describe(context.input.sender.id);
  },
});
```

> **两个 context 不是同一个东西**，别混用：
> `setup(context)` 里 `context.resources` 是 Scope —— `provide` / `use` / `has` 都挂在它上面。
> 能力的 `execute(context)` 拿到的是 CapabilityContext —— 直接 `context.use(token)` /
> `context.config`，**没有** `context.resources`，写成 `context.resources.use(...)` 会在运行期
> 报 `Cannot read properties of undefined`。

## 硬性规则

这些不是风格偏好，违反会让迁移在运行期而不是编译期爆炸：

- **`usePlugin()` / `getPlugin()` 不得出现在能力执行路径。** 新运行时不建立
  AsyncLocalStorage 上下文，调用它只会拿到一个挂空的孤儿 Plugin，注册的东西永远不生效。
- **不双写。** 同一能力不要既留旧 registry 又建新目录，`status` 会一直停在 `dual-run`。
- **不引入 `@zhin.js/next-*` 或 legacy callback adapter。**
- **Command 参数只由文件名表达**，不要在 metadata 里维护第二套路由。
- **消息发送必须走统一 render/send 链路**，不要在能力里直连 endpoint。
- **自动迁移无法证明语义等价时，保留 diagnostic 人工改写**，不要做猜测性替换。
- **每个 `register` / 订阅都要有 disposer** 交给 `context.lifecycle`，否则热更新会重复注册。

## 完成标准

```bash
zhin runtime migrate status                  # state 必须是 ready（退出码 0）
rg -n "usePlugin\(|getPlugin\(|add(Command|Middleware|Component|Tool|Cron)\(|@zhin.js/next-" .
pnpm --filter <plugin-package> build
pnpm --filter <plugin-package> test
pnpm check:plugin-runtime-migration-readiness
pnpm check:plugin-runtime-migration-verify
```

公开插件还必须验证 tarball，而不是只验证源码类型检查：

```bash
pnpm --filter <plugin-package> run build
pnpm --filter <plugin-package> pack
# 解开 tarball，确认 package/plugin.js、package/plugin.d.ts 和已编译的能力目录存在
```

`rg` 只允许命中文档与迁移测试。`ready` 意味着静态检查通过，**不等于行为等价** —— 平台相关
行为（真实适配器收发、定时触发）要么实测，要么在交付说明里写清未验证项，不要用"编译通过"
替代运行时验证。

## 仓库门禁

仓库内声明 `zhin.type: "plugin"` 的包会由 `check:plugin-runtime-migration-readiness` 做确定性检查。
它只扫描当前 checkout，不读取 cwd 之外的用户项目；`tests/`、`test/`、`fixtures/`、`__fixtures__/`
和带 `zhin-migration-gate: legacy-fixture` 标记的源码会被排除。因此迁移示例可以保留旧 API，
但 native Plugin Runtime 的生产源码不能在函数体内调用 `usePlugin()` 或 `getPlugin()`。

## 离线 Verify

`pnpm check:plugin-runtime-migration-verify` 是 migration 的离线 E2E verify：先确认 cutover
已经无变更，再用不触发 install 的 `pnpm run build` 验证构建。私有 development root 额外要求
`scripts.dev` 与 `scripts.start` 都是 `zhin runtime start`；公开 publish package 会执行
`pnpm pack`，解读 tarball 后确认 `package.json#zhin.entry`、
`plugin.js`、`plugin.d.ts` 和每个已发现能力目录的 JS 产物一致。它不执行 install，也不会访问网络。
