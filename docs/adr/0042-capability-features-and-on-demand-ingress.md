# ADR 0042: Capability Features 与按需 Capability Ingress

## 状态

Accepted with amendment；Feature package ownership 与通用 provider contract 由 ADR 0048 修订。

## 背景

Agent 能力（Tool / Skill / Agent 预设 / MCP）存在多条写入路径：`defineAgentTool` discovery 双写 Orchestrator + ToolFeature、builtins 只写 ToolFeature、回合收集再经 ToolSystem 多 Source 拼池。理解「一个工具如何进入模型」需要跨越多处模块，Feature 与 Orchestrator 谁是权威也不清。

领域讨论定稿：Plugin 能力边界用四个 Feature 表达；运行时回合权威仍是 Agent Orchestrator；装载经 Capability Ingress，而不是 mount 全量双写。

## 决策

### D1. Feature = 装配面；Orchestrator = 回合权威

| 层 | 职责 |
|----|------|
| **Capability Feature** | Plugin 可写能力表 + 生命周期（作者 / discovery 只写这里） |
| **Agent Orchestrator** | 回合可读的工具 / 技能 / 子代理 / MCP 运行时注册表 |
| **Capability Ingress** | Feature（及常驻核心）→ Orchestrator 的唯一装载 seam |

不退役 Orchestrator；不把 Feature 当作回合 SSOT。

### D2. 四个 Agent Feature 分层（历史落点）

- **ToolFeature** / **SkillFeature**：`@zhin.js/core`（已有）
- **AgentFeature** / **MCPFeature**：`@zhin.js/agent`
  - AgentFeature：专长 / 子代理预设（目标约定 `agents/*.md`）；**不**替代配置主绑定
  - MCPFeature：MCP server **声明**；不含已连接工具列表

目标架构不再由 Core/Agent 包硬编码这四个 Feature 的发现与存储。它们分别成为可发布 Feature provider，并通过通用 owner-bound Slot 接入；本 ADR 保留 Capability Ingress 与 Orchestrator 回合权威的领域边界。

### D3. 主路径 Agent 选用

配置 **`agents[].match`**（ResolvedAgentBinding）是入站选用权威。AgentFeature 仅供给委派 / 专长预设。

### D4. Ingress 时机与范围

- **Boot**：创建 ZhinAgent + Orchestrator 空壳 + Providers；将 **reserved / builtin 常驻核心** Ingress 进 Orchestrator；插件发现只填 Feature。
- **入站**：消息到达且已 resolve Binding 后，按命中 Agent 作用域 **按需** 从 Feature Ingress；结果 **缓存**，直到插件 reload / Feature epoch 变更失效。
- 装载过滤 **复用** Tool 元数据 `platforms` / `scopes` / `permissions`（与 Tool Selection 同一词汇），不新增独立 adapter/scene_type/sender_role 轴。

### D5. Slice 边界（本 ADR 范围）

- **本 ADR / Slice A**：CONTEXT 定稿、Feature 骨架、discovery 只写 Feature、最小 `ensureCore` + `ensureForTurn` 挂钩现有 turn；不深改 ToolSystem。
- **不做**：入站「match → 人格/记忆 → 提示词 → Provider」显式阶段化重构；host MCP `getAll` 全面迁读；硬删 `AgentPresetFeature` 公共名。

## 后果

### 正面

- 作者只学 Feature 装配面；AI 回合只跟 Orchestrator。
- 按需装载与 MCP 懒连接同族，控制冷启动与首包工具面。
- 权限词汇单线，避免 Feature 条件表与 Tool 字段双写。

### 负面 / 风险

- 首条命中某 Binding 时有 Ingress 成本（缓存后摊薄）。
- Slice A 仍并存旧路径（如部分 builtins skill 反查）；Slice B 再扫双写残留。

### 迁移

1. Slice A：骨架 + discovery Feature-only + Ingress 挂钩。
2. Slice B：清双写、host MCP、deprecate AgentPresetFeature 命名。
3. Slice C（可选）：入站流水线阶段 module。

## 参考

- [`packages/im/agent/CONTEXT.md`](../../packages/im/agent/CONTEXT.md)
- ADR 0003（Tool Selection / Context Budget）
- ADR 0039（Eve 对齐创作面）
- [ADR 0048](./0048-plugin-monorepo-and-feature-provider-packages.md)（Feature provider package 与 Plugin monorepo）
