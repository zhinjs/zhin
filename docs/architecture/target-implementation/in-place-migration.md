# Plugin Runtime 原位迁移

`packages/next` 是目标架构的实现孵化区，不是最终产品分层。迁移采用
**replace-in-place**：代码进入已有 ownership 包，旧实现逐步降为兼容适配器，最终删除
全部 `@zhin.js/next-*` 包和 `packages/next` 目录。

机器可读 SSOT 是 [migration-topology.json](./migration-topology.json)。其中 `pending`
必须与仓库里仍存在的 `@zhin.js/next-*` package 一一对应；完成一个迁移时，同时删除源
package、补齐目标 package export，并把该项移入 `completed`。

## 迁移原则

1. **一个运行时权威**：新 RuntimeSnapshot 是权威；旧 Feature registry 只通过兼容
   Adapter 投影，不能双写。
2. **按依赖方向搬运**：Kernel → Feature Kit → Core → Agent → Console → Root/CLI。
3. **先归位再切流量**：每批先移动源码和测试，再切 workspace consumer，最后删除源包。
4. **兼容只在作者入口**：`addCommand`、`addComponent` 等旧接口可以暂留；Root lifecycle、
   discovery、generation 与 HMR 不保留两套实现。
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
| Root、配置、发现、HMR、隔离与 compat | `zhin.js` |
| start、migrate、scaffold | `@zhin.js/cli` |

## 当前进度

- 已完成：Plugin Runtime、Feature Kit、IM/Agent/Console 领域 Feature、Core IM Runtime、
  `@zhin.js/agent/runtime` 与 `@zhin.js/pagemanager/plugin-runtime`。
- 兼容边界：旧 Agent mutable ingress 暂作为适配器保留；Stable Root 切到 RuntimeSnapshot 后删除。
- 下一批：Client Build adapter 与 Root Runtime 原位归属。
- 完成定义：`rg '@zhin.js/next-|packages/next'` 只允许出现在历史 ADR，workspace 中不存在
  `packages/next`，Stable 示例直接由新 Root Runtime 启动。
