# Plugin Runtime 迁移契约

本文是旧 Zhin Plugin 向正式 Plugin Runtime/Feature 模型迁移的单一事实源。迁移不是在新 Kernel 中复刻旧 registry，而是把旧模块副作用逐步编译为静态 manifest、owner capability 文件和显式 Resource。

## 迁移阶段

```mermaid
flowchart LR
  Inventory["migrate --check\nAST inventory"] --> Extract["migrate --write\ncapability extraction"]
  Extract --> Refactor["manual context/resource refactor"]
  Refactor --> Preview["migrate cutover --check\nmanifest preview"]
  Preview --> Switch["migrate cutover --write\nentry + manifest transaction"]
  Switch --> Compare["dual-version behavior comparison"]
  Compare --> Status["migrate status\nlegacy/compat inventory"]
  Status --> Remove["remove legacy imports"]
```

两个阶段的 `--check` 都不写盘，所有迁移命令都不执行旧 Plugin。TypeScript AST inventory 识别 `addCommand()`、`addMiddleware()` 和 `addComponent()`；只有模块顶层且满足各自安全子集的注册才自动提取，其他调用产生按源文件、源码位置稳定排序的 diagnostic。

## 自动 Command 子集

当前自动支持：

- 一个 string literal pattern。
- 最多一个且位于末尾的 `<name:text|string|number|boolean>` 参数。
- 一个 inline arrow/function action。
- 可选且只调用一次的 `.desc(...stringLiteral)`。
- action 只引用参数、函数内声明和明确的 JavaScript/Node global。

```text
gh pr <title:text>
  -> commands/gh/pr/[title:string].ts
```

输出使用原生 `defineCommand()`，并在 `execute(context)` 内显式映射旧
`message/result` 到 `context.input/params/args`。路由 identity、类型转换、owner
config/resource 和 lifecycle 由 Command Feature 接管。

以下情况必须 manual：外部闭包、Plugin/logger/context、动态 pattern、多个 action、`.permit()`、复杂 SegmentMatcher、非末尾或多个动态参数、目标路径冲突。工具宁可少迁移，也不生成表面可编译但行为错误的代码。

## 自动 Middleware 与 Component 子集

Middleware 自动提取要求模块顶层 `addMiddleware(inlineFunction, optionalStaticName)`。名称优先取第二个 string literal，其次取具名函数；单 middleware 文件还可使用文件名。callback 不得捕获源文件 binding，输出到 `middlewares/<name>.ts` 并通过原生 `defineMiddleware()` 显式映射 `context.input`。

Component 自动提取要求 `addComponent()` 引用模块顶层函数/arrow binding，或传入具名 inline function。render 最多接收一个 props 参数且不得捕获源文件 binding，输出到 `components/<kebab-name>.ts|tsx`。旧版第二个 `ComponentContext` 参数、import/closure、依赖 Plugin Context 的 JSX 均进入 manual 清单，不伪造新 Context。

模块初始化之后才调用的 `add*()` 一律进入 manual 清单，因为它们的 owner 和生命周期不能仅凭语法可靠推断。

## 写入事务

`migrate --write` 先验证整个 plan；目标必须按 capability 位于 `commands/`、`middlewares/` 或 `components/` 内且不存在。全部内容先写到同目录临时文件，准备完成后才用排他 hard-link 原子发布，拒绝并发创建的同名目标。失败时删除本次创建的 target 和 temporary。旧 source 保持不变，因此 extraction 可审查、可丢弃，也保留旧版本回滚能力。

`zhin runtime migrate cutover --write` 是独立事务。它从已生成目录推导 Feature provider，
补充 Plugin Runtime 与 Feature dependencies，生成纯 Plugin entry，最后提交
`package.json#zhin`。原始 package 文本是乐观并发令牌；并发修改会拒绝提交。

cutover 不删除旧 entry/source，也不声称已经完成行为迁移。完成后应运行迁移前后的行为对照；仓库中的 [`examples/plugin-runtime-migration-bot`](../../../examples/plugin-runtime-migration-bot/README.md) 是可执行 tracer。

`zhin runtime migrate status` 是迁移退出条件的机器可读 SSOT。旧 compat import 会被报告
为阻塞项，必须由迁移 Skill 改成原生 Feature definition。

`zhin runtime start --once` 是 cutover 后的最小运行验收。它必须真实读取 config、解析
生产 Feature provider、加载本地 capability、提交 generation 并完成 drain/stop。

## Compatibility 边界

Runtime 不提供 Compatibility API。无法通过纯参数转换表达的能力必须迁移为新
Resource/Feature contract；具体流程由 `.github/skills/migrate-zhin-plugin-runtime` 承担。

## API 冻结

`tests/snapshots/plugin-runtime-api.json` 记录正式 Runtime package 与公开 subpath 导出。

## 当前覆盖

| 旧能力 | 自动提取 | 后续 |
|---|---|---|
| `MessageCommand` 静态子集 | 已实现 | permission/help metadata、复杂 matcher |
| `addMiddleware` 静态无闭包子集 | 已实现 | owner/target/phase 的复杂推断 |
| `addComponent` 静态无 Context 子集 | 已实现 | JSX/import/render contract 迁移 |
| `provideContext/useContext` | 不自动 | 显式 Token/Resource |
| Adapter/Endpoint | 不自动 | Feature + generation handoff |
| Tool/Agent/Skill | 目录已有 | 旧 package 批量搬迁 |
