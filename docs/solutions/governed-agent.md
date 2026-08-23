---
title: 受治理的业务 Agent
---

# 让 Agent 理解业务，但不因此越权

适合把内部术语、输出规范和业务工具交给 Agent 的团队。交付结果是可热更的业务上下文、显式工具权限、风险审批和可回放运行记录。

## 四个独立控制面

| 控制面 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Prompt Section | 术语、规范、工具使用提示 | 不授予工具或数据权限 |
| Tool Feature | 输入 Schema、执行与模型回传 | 不决定 Host 执行策略 |
| `approval` | 哪类调用需要人确认 | 不扩大工具可见范围 |
| `ai.agent` | 命令执行预设、白名单与迭代上限 | 不修改提示词正文 |

## 实施步骤

1. 在插件 `agent/prompt-sections/` 声明必需或可选分段，并给出明确预算。
2. 在 `agent/tools/` 暴露最小工具，输入使用结构化 Schema；有副作用的工具不得设为无条件免审批。
3. 从 `execSecurity: deny` 或 `allowlist` 起步，仅在已知工作目录开放所需命令。
4. 启动后在 Console 的“运行时能力 → Prompt Sections”核对 owner、来源、profile 与预算策略。
5. 在 Agent 工作台运行一条只读任务和一条有副作用任务，确认审批、取消、轨迹和产物符合预期。

## 验收清单

- 热更失败时，进行中的回合仍使用启动时的固定 Prompt Section 快照。
- Console 能证明分段已进入当前 generation，但不会泄露正文和 metadata。
- 取消后的工具不会被投影成正常完成；副作用结果可被审计。
- 工作目录和安全策略由每次运行显式选择，不从聊天文本隐式提升。

实现细节见 [Agent 工具与 Prompt Section](/authoring/agent-tools) 和 [Agent 深入](/ai/agent)。
