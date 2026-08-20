# Public API 面（Public API Surface）

本清单是「一个 API 是 public 还是 internal」的判定 SSOT。目标是：维护者 10 分钟内能对任意符号做出判断，不需要读实现。

分三档：

| 档位 | 标签 | 含义 |
|------|------|------|
| Stable Public | `stable` / `experimental` | 用户侧创作面，承诺 semver（`experimental` 可在 minor 中调整，调整前在 changelog 明示） |
| Internal | `internal` | 框架内部机制。可读、可调试，但**不承诺不 break**，任何版本都可能变 |
| Deprecated | `deprecated` | 已迁移/不再推荐。保留兼容一个 minor 周期后删除 |

> 标注位置：源码 JSDoc（`@public` / `@internal`）优先标注入口文件；本清单为完整列表，二者冲突时以本清单为准并提 PR 修正。

## Stable Public（承诺 semver）

### define\* 创作函数

> 应用侧请从 **`zhin.js/*` 门面子路径**导入（依赖 `zhin.js` 即可）。下表「实现包」是 Feature provider / platformFeatures 挂载名，**不要**再单独 `pnpm add` 这些实现包。

| API | 稳定性 | 作者 import | 实现包 | 一句话 |
|-----|--------|-------------|--------|--------|
| `definePlugin` | `stable` | `zhin.js/plugin-runtime` | `@zhin.js/plugin-runtime` | 约定式插件入口，`plugin.ts` 默认导出 |
| `defineCommand` | `stable` | `zhin.js/command` | `@zhin.js/command` | 命令模块（`commands/` 下默认导出） |
| `defineAdapter` | `stable` | `zhin.js/adapter` | `@zhin.js/adapter` | 适配器模块（`adapters/` 下默认导出），`create(context)` 返回 Endpoint |
| `defineComponent` | `stable` | `zhin.js/component` | `@zhin.js/component` | Satori/SSR 组件（`components/` 下默认导出） |
| `defineMiddleware` | `stable` | `zhin.js/middleware` | `@zhin.js/middleware` | 中间件模块（`middlewares/` 下默认导出） |
| `defineHandler` | `stable` | `zhin.js/handler` | `@zhin.js/handler` | Lifecycle 事件处理器（`handlers/` 下默认导出；路径段用 `.` 拼接） |
| `defineAgentTool` | `experimental` | `@zhin.js/tool`（`tools/`）；`zhin.js/agent`（`agent/tools/*.ts`） | `@zhin.js/tool` | AI 工具模块，Agent 自动发现 |

> 注意：**没有 `defineAgentSkill`**。Agent 技能是纯 Markdown（`agent/skills/*.md`，由 `@zhin.js/skill` 的 `parseSkillMarkdown` 解析），不是代码符号。

### 约定目录与文件

| 约定 | 稳定性 | 消费方 | 一句话 |
|------|--------|--------|--------|
| `plugin.ts` | `stable` | `@zhin.js/plugin-runtime` | 插件根入口，默认导出 `definePlugin(...)` |
| `commands/` | `stable` | `@zhin.js/command`（作者 import：`zhin.js/command`） | 命令模块目录，支持 `[name]` / `[[name]]` / `[...name]` 动态参数段 |
| `adapters/` | `stable` | `@zhin.js/adapter`（作者 import：`zhin.js/adapter`） | 适配器模块目录 |
| `middlewares/` | `stable` | `@zhin.js/middleware`（作者 import：`zhin.js/middleware`） | 中间件模块目录 |
| `handlers/` | `stable` | `@zhin.js/handler`（作者 import：`zhin.js/handler`） | Lifecycle 事件处理器目录（路径段用 `.` 拼接；当前运行时接线 `message.receive`） |
| `tools/` | `experimental` | `@zhin.js/tool` | Agent 工具目录（`defineAgentTool`） |
| `agent/tools` | `experimental` | `zhin.js/agent` authoring | 文件化 Agent 工具创作面 |
| `agent/skills` | `experimental` | `@zhin.js/skill` / Agent 发现 | Agent 技能 Markdown（随 npm 包发布） |
| `pages/` | `experimental` | `@zhin.js/console-page` | Console 页面模块目录 |

### Host Token（`context.resources.use(token)` 消费）

| Token | 稳定性 | 来源包 | 一句话 |
|-------|--------|--------|--------|
| `databaseHostToken` | `stable` | `@zhin.js/plugin-runtime` | 数据库 Host 能力 |
| `scheduleHostToken` | `stable` | `@zhin.js/plugin-runtime` | 定时任务 Host 能力 |
| `outboundHostToken` | `stable` | `@zhin.js/plugin-runtime` | 跨平台出站消息能力 |
| `messageGatewayToken` | `stable` | `@zhin.js/core`（`zhin.js/core/runtime`） | 入站消息投递网关（适配器用） |
| `httpHostToken` | `stable` | `@zhin.js/host-http` | HTTP/WS Host 能力（Console、Webhook 用） |

### Removed Legacy Hooks

| API | 稳定性 | 来源包 | 一句话 |
|-----|--------|--------|--------|
| `usePlugin()` 及配套 Hooks（`provide` / `addCommand` / `useContext` 等） | `removed`（见下表） | `zhin.js`（`@zhin.js/core`） | 已移除，调用 throw；唯一入口为 `definePlugin` + `zhin runtime start` |
| `MessageCommand` / `CommandFeature` | `deprecated` | `zhin.js`（`@zhin.js/core`） | 经典命令；新代码用 `defineCommand` + `commands/` |
| `bootstrapNode` / `zhin.js/node` | `removed` | 无（子路径已删除） | 唯一启动入口为 `zhin runtime start` |

### `zhin.config.yml` 顶层键

| 键 | 稳定性 | 消费方 | 一句话 |
|----|--------|--------|--------|
| `plugins.<key>` | `stable` | `@zhin.js/cli` 装配层 | 插件启用与插件级配置 |
| `endpoints[i]` | `stable` | `@zhin.js/cli` 装配层 | 适配器实例列表（含 `master` / `trusted` / `commandPrefix`） |
| `commandPrefix` | `stable` | `MessageDispatcher` | 命令前缀，实例顶层 + endpoints 逐项覆盖 |
| `ai` | `stable` | `@zhin.js/cli` AI Host 装配 | AI/Agent 配置 |
| `http` | `stable` | `@zhin.js/host-http` 装配 | HTTP Host 配置 |
| `database` | `stable` | database Host 装配 | 数据库配置 |
| `speech` | `stable` | speech Host 装配 | 语音配置 |
| `log_level` | `stable` | `@zhin.js/cli` | 日志级别（`ZHIN_LOG_LEVEL` 可覆盖） |

> 其余 Host 级键（`mcp` / `a2a` / `htmlRenderer` / `assistant`）同属 stable 顶层键，完整表见 [配置概览](../configuration/index.md)。

### CLI 命令

| 命令 | 稳定性 | 来源包 | 一句话 |
|------|--------|--------|--------|
| `zhin runtime start` | `stable` | `@zhin.js/cli` | Plugin Runtime 启动入口（composition root） |
| `zhin setup` | `stable` | `@zhin.js/cli` | 已有项目增量配置向导 |
| `zhin doctor` | `stable` | `@zhin.js/cli` | 环境/配置体检 |
| `pnpm create zhin-app` | `stable` | `create-zhin-app` | 新建项目脚手架 |

## Internal（可读但不承诺不 break）

| API | 稳定性 | 来源包 | 一句话 |
|-----|--------|--------|--------|
| `RootRuntime` / `RootController` | `internal` | `@zhin.js/plugin-runtime` | 插件树与 generation 的根控制器 |
| `CapabilitySlot` | `internal` | `@zhin.js/plugin-runtime` | 能力槽，feature 与 projection 之间的载体 |
| `SnapshotStore` / `RuntimeSnapshot` | `internal` | `@zhin.js/plugin-runtime` | 原子快照存储，projection 的输入 |
| `AdapterIndex` | `internal` | `@zhin.js/adapter` | 适配器 projection，快照 → Endpoint 装配 |
| `CommandIndex` | `internal` | `@zhin.js/command` | 命令 projection，快照 → 命令路由表 |
| `ToolIndex` / `SkillIndex` / `McpIndex` / `PageIndex` / `LayoutIndex` 等 | `internal` | 各 feature 包 | 其余 projection，同属内部机制 |
| `defineFeatureProvider`（Feature Provider 协议） | `internal` | `@zhin.js/feature-kit` | 新增 feature 类型的协议，面向框架扩展者而非插件作者 |
| `MessageDispatcher` | `internal` | `@zhin.js/core` | 消息分发器（`createMessageDispatcher` 装配，路由策略可配置） |
| `basic/cli/src/plugin-runtime/*-installer.ts` | `internal` | `@zhin.js/cli` | Root Host 安装器（database / schedule / outbound / inbox / http / console / agent / speech / html-renderer / protocol），装配细节随时可变 |

## Deprecated / 已迁移

| 项 | 稳定性 | 现状 | 一句话 |
|----|--------|------|--------|
| legacy `usePlugin()` / `getPlugin()` 插件体系 | `removed` | 调用 throw（throwing stub） | 唯一入口：`definePlugin` + `zhin runtime start` |
| `MessageCommand` / classic `CommandFeature` | `deprecated` | Agent init / game-kit hub 仍用 | 迁到 `defineCommand` + Runtime `CommandIndex` 后删除 |
| `bootstrapNode` / `zhin.js/node` | `removed` | 不再导出 | 唯一启动入口：`zhin runtime start` |
| 「`host` 插件」叙事 | `deprecated` | 文档已收口 | Host 能力改为 token 化（见上表 Host Token），不再是插件概念 |
| `examples/test-bot` 作为用户路径 | `deprecated` | 维护者厨房水槽 | 用户路径为 minimal-bot（Stable）→ full-bot（L4），勿把 test-bot 配置当模板 |
| `plugin.yml` 插件清单 | `deprecated` | legacy `Plugin` 与 `zhin build` 仍在读取（`packages/im/core/src/plugin.ts`、`basic/cli/src/libs/plugin-package-build.ts`） | 属 legacy 体系的一部分，随 legacy 一起退役；约定式插件以 `package.json` 为准 |

## 判定规则（新增 API 放哪档）

按顺序问三个问题：

1. **这是插件作者/用户会直接写的东西吗？**（define\* 函数、约定目录、配置键、CLI 命令、Host token）
   → 是：默认 **Stable Public**。AI/Console 等尚未收敛的创作面先标 `experimental`，收敛后升 `stable`。
2. **这是快照 → projection → 装配链路里的机制吗？**（`*Index`、`SnapshotStore`、`CapabilitySlot`、installer、dispatcher、Feature Provider 协议）
   → 是：默认 **Internal**。内部机制即使被导出（跨包复用）也不因导出而变成 public。
3. **要删除/替换一个已有 public API？**
   → 先标 `deprecated`（JSDoc `@deprecated` + 本清单移动 + changelog 明示），**保留至少一个 minor 周期**再删除；删除本身属 breaking，走 major 或按仓库发版约定处理。

兜底：拿不准的按 **Internal** 处理——从 internal 升 public 不 break 任何人，反过来则是 breaking。

相关文档：[代码约定](./conventions.md)、[开发流程与门禁](./development.md)、[插件模型](../concepts/plugin-model.md)。
