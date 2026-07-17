# @zhin.js/next-cli

下一代 Plugin monorepo 的轻量 CLI。它初始化 Root project、创建一级 child Plugin 或 Feature package、启动 Node 原生 TypeScript Root、检查静态 graph，并按依赖顺序执行 build/publish。

> 当前包属于 `feature/next` 绿地实现，命令名暂为 `zhin-next`，版本仍为 `0.0.0` 且未作为稳定 CLI 发布。

## 设计边界

- 一个 Plugin package 本身就是可独立运行的 Root project。
- `plugins/*` 只保存该项目携带的一级 workspace child；child package 内不能再嵌套 workspace。
- `packages/*` 保存贡献给 Zhin 的 Feature provider package。
- child 既可以来自本地 workspace，也可以来自普通 npm dependency。
- graph、build 和 publish 使用同一份 `package.json#zhin` SSOT。
- HMR transaction 由 Runtime 掌权；CLI 只持有 Root Host、信号与 process restart 策略。
- CLI 不内置 TypeScript 编译器、Vite、第三方 watcher 或 npm registry 客户端封装。

## 命令

```bash
zhin-next init [package-name]
zhin-next create plugin <name> [package-name]
zhin-next create feature <name> [package-name]
zhin-next inspect
zhin-next start [--once] [--no-watch] [--environment <name>] [--mode <mode>]
zhin-next migrate --check
zhin-next migrate --write
zhin-next migrate cutover --check
zhin-next migrate cutover --write
zhin-next migrate status
zhin-next build
zhin-next publish [--execute] [--resume] [--tag <tag>]
```

### 初始化项目

```bash
mkdir my-plugin && cd my-plugin
zhin-next init @acme/my-plugin
```

生成 `package.json`、`plugin.ts`、`schema.json`、`tsconfig.json` 与 `pnpm-workspace.yaml`。

生成的 tsconfig 对齐 Node 原生 TS：`NodeNext`、`erasableSyntaxOnly`、`verbatimModuleSyntax` 与 `rewriteRelativeImportExtensions`。Next TS 源码的本地相对 import 使用 `.ts` 扩展；构建产物由 TypeScript 重写为 `.js`。这条约定仅适用于 Next 原生开发面，不追溯修改 Stable 4.x 源码约定。

### 创建 child Plugin

```bash
zhin-next create plugin reports @acme/plugin-reports
```

CLI 创建 `plugins/reports`，并更新 Root dependency 与 `zhin.plugins` mount；`instanceKey` 使用本地名称 `reports`。

### 创建 Feature

```bash
zhin-next create feature task @acme/feature-task
```

CLI 创建 `packages/task/src/provider.ts`，并更新 Root dependency 与 `zhin.features` requirement。

所有新建 Root、child Plugin 与 Feature package 都声明 `zhin.engine: ^1.0.0`；Feature 同时声明具体 `featureApi: 1.0.0`，调用方 requirement 使用 `^1.0.0`。Root tsconfig 覆盖 Command、Middleware、Component、Adapter、Tool、MCP、Page/Layout 以及一级 `plugins/*`、`packages/*` 的 TypeScript/TSX 源码；Agent/Skill Markdown 不进入 TypeScript 编译。

### 检查、构建与发布

```bash
zhin-next inspect
zhin-next build
zhin-next publish
zhin-next publish --execute
zhin-next publish --resume
```

- `inspect` 输出 Plugin tree、Feature mount 与确定性的 package build order。
- `build` 只运行 workspace package 中存在的 `scripts.build`。
- `publish` 默认执行 `pnpm publish --dry-run --no-git-checks`。
- 只有显式 `--execute` 才真实发布；private package 不发布。
- 真实发布先使用 plan-specific `zhin-txn-*` staging dist-tag，全部 package 发布后再提升到 `--tag` 指定的 tag（默认 `latest`）。
- `.zhin/publish-journal.json` 在每个远程步骤前后原子更新；`--resume` 只恢复相同 plan fingerprint。
- 恢复 running/failed step 前通过 npm registry 探测 version/dist-tag；状态不可判定时拒绝重试。
- public package 依赖 private package 时，会在运行任何 publish step 前失败。
- npm dependency 只参与解析，不会被 CLI build 或 publish。

### 启动 Root

```bash
zhin-next start
zhin-next start --once
zhin-next start --environment staging --mode production
```

- `start` 读取唯一的 `config.yml`、`config.yaml`、`config.json`、`zhin.config.yml` 或 `zhin.config.yaml`；多份配置会拒绝启动。
- `--once` 完成 graph/config/setup/discovery/generation commit 后立即 drain/stop，用于 CI smoke。
- 默认启动 HMR；`--no-watch` 只关闭 watcher，不改变 Runtime transaction。
- SIGINT/SIGTERM 会先停止 watcher，再等待全部 snapshot lease 与 Resource disposer。
- process 级变化输出 restart plan、优雅停止并使用退出码 `75`，交给外层 supervisor 重启。

开发启动使用 Node 原生 type stripping。Node 22.6–22.17 由 CLI 自动附加 `--experimental-strip-types` 并重启自身；22.18+ 直接运行；Node 20 仍可运行预编译生产 ESM，但不能使用原生 TS `start`。原生 Node 要求相对 import 写真实 `.ts` 扩展，不支持 TSX，也不执行 `node_modules` 中的 TS。Page/Layout TSX 继续经过 Client Build adapter；服务端 Component TSX 必须预编译。

### 迁移旧能力

`migrate --check` 使用 TypeScript AST 输出 automatic/manual/error inventory，不执行旧模块。`migrate --write` 在 plan 无 error 时提取可静态证明的模块顶层 Command、Middleware 和 Component，并保持旧 source 不变。

```text
new MessageCommand('gh pr <title:text>')
  -> commands/gh/pr/[title:string].ts
```

Command 与 Middleware 分别通过 `defineLegacyCommand()` / `defineLegacyMiddleware()` 保留 callback 形状；安全的 Component 直接转为 `defineComponent()`。外部闭包、运行时注册、Plugin Context、旧 ComponentContext、`.permit()`、复杂 matcher 或路由冲突会保留为带源码位置的 manual/error diagnostic。写入先准备全部 temporary，再用排他 hard-link 发布，绝不覆盖并发创建的目标。

`migrate cutover --check` 预览 Feature provider 与依赖变化；`--write` 生成 `plugin.next.ts` 并最后原子提交 `package.json#zhin`。它拒绝覆盖已有 manifest/入口，并在 package 被并发修改时中止。cutover 仍保留旧 entry/source，真正删除 legacy import 前应运行双版本行为对照，参考 [`examples/next-migration-bot`](../../../examples/next-migration-bot/README.md)。

`migrate status` 输出 `blocked | extraction-required | cutover-required | dual-run | compat | ready` 状态，并列出 legacy/compat import 的文件与位置。`blocked` 返回非零退出码；其他状态由 CI 按迁移阶段决定是否允许。

迁移命令需要项目开发环境安装 `typescript` peer；默认 CLI 与生产 Runtime 不携带编译器、Vite 或 watcher。

## 编程 API

```ts
import {
  NodeProcessRunner,
  ProjectCommands,
  ProjectScaffolder,
} from '@zhin.js/next-cli';

const commands = new ProjectCommands();
const graph = await commands.inspect(process.cwd());
const plan = commands.buildPlan(graph);
await commands.execute(plan, new NodeProcessRunner());
```

测试或上层工具可以实现 `ProcessRunner`，在不启动真实子进程的情况下验证计划。

## 当前限制

- 当前 codemod 只覆盖可静态证明且无源文件闭包的子集；复杂 permission、Context/Resource、JSX import 与动态注册仍需人工迁移。
- 本地 Root manifest 仍可指向 TS；npm 发布前把 Plugin/Feature manifest 切换为预编译 JS 的 artifact transaction 尚待下一阶段完成。
- npm 登录和 registry 凭据仍由 pnpm/npm 环境管理，CLI 不保存 token。
- 不生成具体 Command/Agent/Page Feature；这些由对应 Feature package 或后续模板提供。

## 开发验证

```bash
pnpm --filter @zhin.js/next-cli test
pnpm --filter @zhin.js/next-cli build
pnpm --filter @zhin.js/next-cli check:api
pnpm --filter @zhin.js/next-cli check:size
```

## 相关文档

- [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)
- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
- [Next 迁移契约](../../../docs/architecture/target-implementation/migration-contract.md)
- [Next 架构总览](../README.md)
