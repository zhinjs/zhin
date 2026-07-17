# ADR 0048: Plugin Monorepo 与 Feature Provider 包

## 状态

Accepted；全新项目目标架构。

## 背景

一个 Zhin Plugin 不只是若干运行时回调的集合，而是可以独立开发、测试、构建和发布的产品工程。它需要同时容纳自身能力、本地子 Plugin，以及可复用的 Feature 实现。

物理源码组织与运行时 Plugin tree 是两个不同问题。如果用嵌套目录表达运行时父子关系，会产生 nested workspace、重复 lockfile、构建边界不清和本地包解析歧义。反过来，如果 Kernel 写死 Command、Tool、Agent 等能力类型，第三方就无法以同等地位扩展新的创作面。

## 决策

### D1. 每个 Plugin 项目只有一个 Monorepo Root

本 ADR 固定两个术语：

- **Plugin Project**：具有 workspace、lockfile、CLI 与开发生命周期的工程。
- **Plugin Package**：可被实例化、依赖和发布的运行单元。

任意 Plugin Package 单独检出后都可以成为一个 Plugin Project；嵌入另一个 Project 时则只是一级 workspace package。

Canonical workspace 结构为：

```text
<plugin-project>/
├── package.json
├── pnpm-workspace.yaml
├── plugin.ts
├── schema.json
├── packages/
│   └── <feature>/
├── plugins/
│   └── <child-plugin>/
├── pages/
├── commands/
├── components/
├── middlewares/
├── agents/
├── skills/
├── tools/
└── mcp/
```

`pnpm-workspace.yaml` 只包含一级包：

```yaml
packages:
  - packages/*
  - plugins/*
```

- `plugins/*` 是本项目携带的本地 Plugin package，只允许一层。
- `packages/*` 是本项目实现或贡献的 Feature provider package，只允许一层。
- 禁止 `plugins/**`、`packages/**` 和嵌套 workspace root。
- `plugins/foo` 内可以有 `skills/`、`commands/` 等能力目录，但不能再有作为当前 workspace package 的 `plugins/bar`。

“每个 Plugin 都是 monorepo 项目”表示该 package 单独检出时可以成为一个 workspace root；当它作为另一个项目的本地 child 时，它是外层 `plugins/*` 下的一个普通 workspace package，不形成嵌套 monorepo。

### D2. 物理目录不表达逻辑 Plugin tree

逻辑父子关系由 package 的静态 Zhin manifest 声明：

```json
{
  "name": "@acme/plugin-a",
  "dependencies": {
    "@acme/plugin-b": "workspace:*",
    "@acme/plugin-c": "^1.0.0"
  },
  "zhin": {
    "type": "plugin",
    "entry": "./plugin.ts",
    "features": [
      { "package": "@zhin.js/feature-command" },
      { "package": "@zhin.js/feature-component" }
    ],
    "plugins": [
      { "package": "@acme/plugin-b", "instanceKey": "b" },
      { "package": "@acme/plugin-c", "instanceKey": "c" }
    ]
  }
}
```

- package dependency 决定模块是否可解析，`zhin.plugins` 决定是否实例化为 child。
- npm dependency 不会因为带有 Zhin metadata 就被自动执行。
- child package 可以解析到 `plugins/*` 的 workspace link，也可以解析到 npm 安装结果；RootController 不区分来源。
- B 声明 D/E/F 时，运行时树可以递归；它们在当前源码 workspace 中仍必须物理扁平，或来自 npm。
- `instanceKey` 决定 config、route、日志和 runtime identity 的相对路径；package name 不是实例 identity。

静态拓扑必须能在不执行 TypeScript 的前提下被 CLI、构建器和发布器读取。`plugin.ts` 只承担 setup 与特殊资源装配，不再声明 children 或扫描目录。

### D3. Feature 是可发布的 Provider Package

Command、Component、Skill、Tool、Agent、Page、Layout 和 Middleware 都不是 Kernel 内建枚举项，而是标准 Feature provider package。第三方 Feature 与官方 Feature 使用同一接口。

一个 Feature provider 拥有：

1. 稳定 `FeatureId`。
2. 作者侧 definition helper 与类型。
3. 一个或多个目录 convention 和 source parser。
4. definition validation 与 diagnostic。
5. generation-scoped runtime projection/consumer factory。
6. 可选 build manifest 和 client compiler hook。

Provider 的公共 interface 分成三段，避免所有 Feature 被迫依赖不需要的构建或客户端能力：

- `FeatureAuthoring`：convention、load 与 definition validation。
- `FeatureRuntime`：generation-scoped projection。
- 可选 `FeatureBuildAdapter`：server/client artifact plan。

Kernel 只保存 `(owner, feature, localName)` 形成的 Slot，不知道 command、agent 或 page 的语义。

Root package 的 `zhin.features` 是允许参与发现和运行的 Feature 集合。只有已声明且可解析的 provider 才能扫描其目录，避免全局魔法发现和目录名冲突。

Feature requirement 不沿 Plugin tree 隐式继承。每个 Plugin Package 声明自己使用的 provider；RootController 在整树范围按 `FeatureId` 聚合并要求同一 generation 只有一个实现，然后只对声明该 Feature 的 Plugin root 执行发现。

标准发行建议：

```text
@zhin.js/feature-command
@zhin.js/feature-component
@zhin.js/feature-middleware
@zhin.js/feature-agent
@zhin.js/feature-skill
@zhin.js/feature-tool
@zhin.js/feature-page
```

`defineCommand()` 由 Command Feature 包导出；`defineAgentTool()` 由 Tool Feature 包导出。`zhin.js` 可以提供经过 package exports 显式映射的便利入口，但不能重新实现这些 definition。

### D4. 发现约定归 Feature 所有

标准 Feature 默认约定为：

```text
commands/<name>.ts|tsx
components/<name>.ts|tsx
middlewares/<name>.ts
agents/<name>.agent.md
skills/<name>/SKILL.md
tools/<name>.ts
mcp/<name>.ts
pages/<name>.ts|tsx
pages/$nav.tsx
pages/$footer.tsx
```

这些不是 Kernel 常量。Feature package 可以在保持稳定 identity 和安全边界的前提下提供其它约定。不同 Feature 声明相同 source ownership 时，Discovery 在 prepare 阶段报冲突，不采用先扫描者获胜。

Page/Layout 是 client target：Feature provider 只消费 Client Module build artifact，不在 Node 中 import TSX。编译器、browser chunk 与 HMR module URL 由可选 build adapter 提供，不进入 Kernel 或默认 IM 依赖闭包。

`schema.json` 不属于 Feature。它始终是 Plugin package 自身的 Config Resource contract，由 Root Config Composer 处理。

### D5. CLI 管理 Project Graph

目标 CLI 提供：

- `zhin init`：初始化当前 Plugin monorepo、workspace 和 manifest。
- `zhin create plugin <name>`：创建 `plugins/<name>`，并更新 workspace dependency 与 `zhin.plugins`。
- `zhin create feature <name>`：创建 `packages/<name>`，并更新 workspace dependency 与 `zhin.features`。
- `zhin build`：静态校验 manifest，解析 package graph，按拓扑构建 Feature、child Plugin、Root，并生成 server/client manifest。
- `zhin publish`：执行检查、测试、构建、pack 校验，再按 package graph 发布可发布包；`private: true` 的包保留为私有 workspace 节点。

CLI 只扫描 `packages/*` 和 `plugins/*` 的直接子目录。发布过程通过 package-manager adapter 处理 workspace protocol 与 registry version，不用字符串替换 package.json。

### D6. 私有与公开使用同一模型

- 私有 child Plugin 或 Feature 设置 `private: true`，仍可被 workspace Root 使用。
- 可发布包必须声明 `files`、`exports`、构建产物和 `prepublishOnly`。
- Root 可以只发布聚合包，也可以保持私有并仅发布部分 Feature/Plugin。
- 本地开发和 npm 安装只改变 PackageResolver 的解析结果，不改变 RootController、配置树或 Capability identity。

## 不变量

1. 一个 checkout 只有一个 workspace root。
2. 本地 Plugin 和 Feature package 只位于一级 `plugins/*`、`packages/*`。
3. 运行时 Plugin tree 只由静态 manifest 显式声明，可递归且不受物理层级限制。
4. package dependency 不等于自动加载。
5. Kernel 不枚举具体 Feature 类型，也不拥有具体发现目录。
6. Feature provider 是目录约定、definition、验证和 runtime projection 的唯一 owner。
7. `schema.json` 仍由 Plugin Config 系统负责。

## 后果

### 正面

- 私有插件组合和本地联调都使用标准 workspace 能力。
- 每个 child Plugin 与 Feature 都有独立 package 边界，可以单独测试和发布。
- 运行时树不受磁盘布局绑架，npm 与 workspace 来源一致。
- 新领域能力无需修改 Kernel 的类型联合、扫描器或生命周期代码。
- CLI 可以在不执行用户代码的前提下完成 graph、build、publish 与安全检查。

### 设计成本

- package manifest 成为必须严格校验和版本化的公共协议。
- Feature provider 接口需要稳定的 server/client build hook 边界。
- CLI 必须处理 package graph cycle、重复 instanceKey、workspace/npm 版本和 private package。
- 同一 Plugin package 多实例挂载时，Feature projection 必须完全 owner-scoped。

## 参考

- [Plugin-first 目标架构](../../TARGET-ARCHITECTURE.md)
- [目标实现蓝图](../architecture/target-implementation/README.md)
- [Plugin Monorepo 与 Feature 技术实现](../architecture/target-implementation/plugin-monorepo-and-features.md)
- [ADR 0043](./0043-unify-capability-roots.md)
- [ADR 0047](./0047-standalone-plugin-and-root-lifecycle-domain.md)
