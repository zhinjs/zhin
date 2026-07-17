# Plugin Runtime 原位迁移

`packages/next` 曾是目标架构的实现孵化区，不是产品分层。正式化迁移已经采用
**replace-in-place** 完成：代码进入明确 ownership 包，全部 `@zhin.js/next-*` package、
`packages/next` 目录和 Compat Runtime 均已删除。

机器可读迁移档案是 [migration-topology.json](./migration-topology.json)。`pending` 必须为空；
`completed` 和 `removed` 分别记录正式归属与明确删除项，不作为继续支持旧包名的依据。

## 迁移原则

1. **一个运行时权威**：新 RuntimeSnapshot 是权威；旧 Feature registry 只通过兼容
   Adapter 投影，不能双写。
2. **按依赖方向搬运**：Kernel → Feature Kit → Core → Agent → Console → Root/CLI。
3. **先归位再切流量**：每批先移动源码和测试，再切 workspace consumer，最后删除源包。
4. **迁移不进入运行时**：`addCommand`、`addComponent` 等旧接口由 CLI 和迁移 Skill 改写；
   Root lifecycle、discovery、generation 与 HMR 不保留两套实现。
5. **生产入口只指向 JS**：开发条件可直读 TypeScript，发布 manifest 必须指向 `lib/*.js`。

## 最终 Ownership

| 模块 | 最终归属 |
|---|---|
| Plugin tree、Scope、Slot、Snapshot、RootController | `@zhin.js/plugin-runtime` |
| 第三方 Feature provider interface | `@zhin.js/feature-kit` |
| Adapter、Command、Component、Middleware provider | `@zhin.js/adapter`、`command`、`component`、`middleware` |
| IM Runtime | `@zhin.js/core/runtime` |
| Tool、Skill、Agent、MCP provider | `@zhin.js/tool`、`skill`、`agent-feature`、`mcp-feature` |
| Agent Runtime | `@zhin.js/agent/runtime` |
| Page/Layout wire definition | `@zhin.js/contract` |
| Console catalog、navigation、client build | `@zhin.js/pagemanager` |
| Root、配置、发现与 HMR | `@zhin.js/runtime`（`zhin.js/runtime` facade） |
| YAML 保真配置文档 | `@zhin.js/config-yaml` |
| Worker/process 隔离 | `@zhin.js/isolate` |
| start、migrate、scaffold | `@zhin.js/cli` |

## 当前进度

- 已完成：Plugin Runtime、Feature Kit、IM/Agent/Console 领域 Feature、Core/Agent/Console
  Runtime、Root Runtime、YAML Config、Isolate 与 CLI 原位归属。
- 已删除：Compat Runtime。旧 callback/registry 只由 CLI 与
  `.github/skills/migrate-zhin-plugin-runtime` 迁移，不进入生产依赖闭包。
- 下一批：按包迁移仓库旧 Plugin，切换 Stable 示例与正式启动入口，并删除被替代的旧实现。
- 完成定义：`rg '@zhin.js/next-|packages/next'` 只允许出现在历史 ADR，workspace 中不存在
  `packages/next`，Stable 示例直接由新 Root Runtime 启动。
