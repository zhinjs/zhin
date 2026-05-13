# Agent Runtime

Agent Runtime 在 Core IM 概念之上负责 AI 编排：ZhinAgent 回合、工具选择、技能、子代理、上下文预算和安全策略。它的边界是让 Agent 行为保持显式，同时不把 IM 语义下沉到 `@zhin.js/ai`。

## 语言

**ZhinAgent**:
理解 IM 上下文的 Agent 运行时，负责准备提示词、收集工具、运行模型回合，并通过 Core 回复。
_避免使用_：assistant、bot brain、AI plugin

**Agent Orchestrator**:
工具、技能、子代理、MCP 服务和 AI 生命周期 Hook 的注册表所有者。
_避免使用_：manager、registry bag、service locator

**Tool**:
面向 Zhin 运行时的可调用能力，带有元数据、权限级别和可选的上下文注入参数。
_避免使用_：function、command、action

**AgentTool**:
`@zhin.js/ai` 消费的、面向 Provider 的可调用形状。
_避免使用_：raw tool、model tool、function

**Tool Selection**:
把候选 Tool 转换为 AgentTool 的共享流程，包含规范化、权限检查、相关性过滤和 allow/deny 开关。
_避免使用_：tool collection、tool filtering

**Tool Runtime**:
在 Tool Selection 之后决定最终运行时工具列表、上下文工具注入和 Pre-executable Tool 路径的 Agent Runtime 模块。
_避免使用_：tool glue、runtime helper

**Permission Level**:
Tool 进入模型前用于比较调用者和工具权限的有序权限词汇。
_避免使用_：role、ACL、rank

**Skill**:
面向任务的能力包，可以为用户请求浮现配套 Tool。
_避免使用_：plugin、prompt、recipe

**Subagent**:
用于更窄任务或角色的委派 Agent 预设。
_避免使用_：worker、child bot、helper

**Context Budget**:
用于裁剪历史并配置底层 AI Agent 的已解析上下文窗口。
_避免使用_：max tokens、history size、window

**Pre-executable Tool**:
可以在模型回合前执行、用于收集新鲜上下文的 Tool。
_避免使用_：preload、setup action、preflight

## 关系

- **ZhinAgent** 通过 **Agent Orchestrator** 发现 **Tool**、**Skill**、**Subagent**、MCP 资源和 Hook。
- **Tool Selection** 在 **Permission Level** 检查后把 **Tool** 转换为 **AgentTool**。
- **Tool Runtime** 基于 **Tool Selection** 的结果补充上下文工具，并决定 **Pre-executable Tool** 是走快速路径还是完整 Agent 路径。
- **Skill** 可以在通用相关性过滤前贡献 Tool。
- **Context Budget** 同时约束提示词历史裁剪和底层 `@zhin.js/ai` Agent 配置。
- **Pre-executable Tool** 在主模型回合前产出上下文。
- **Subagent** 使用与父级 Agent Runtime 相同的 Provider 和预算词汇。

## 示例对话

> **开发者：** “我可以直接注册一个模型函数作为 **AgentTool** 吗？”
> **领域专家：** “优先向 **Agent Orchestrator** 注册 **Tool**。**Tool Selection** 负责权限检查、上下文注入，以及转换为 **AgentTool**。”

## 已标记歧义

- “tool” 过去同时指 Zhin 运行时工具和 Provider 工具。已决议：**Tool** 是面向 Zhin 的契约；**AgentTool** 是 `@zhin.js/ai` 的契约。
- “maxTokens” 过去混用了生成预算和上下文容量。已决议：**Context Budget** 表示历史/模型窗口；生成限制仍属于模型或 Provider 选项。

