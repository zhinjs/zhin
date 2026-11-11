# 从零理解 Zhin.js

> 一句话：**Zhin.js 是面向多通道 IM 的 TypeScript 机器人与 AI 助手运行时——改文件毫秒级无损热重载、一套 JSX 横跨 20+ 平台自动降级、纯 IM 核心不到 10MB，还能按需接入受控的多模型 AI Agent。**

想直接动手写功能，先看[快速上手](../getting-started/index.md)或[目录约定](../authoring/conventions.md)；本页讲清楚**为什么开发者选择 Zhin.js**，以及一条消息在运行时里经历了什么。

## 为什么选择 Zhin.js（四大核心价值）

### 1. 约定式能力目录与无泄漏热重载（Generation）

把文件放进 `commands/`、`components/`、`middlewares/`、`tools/`、`schedules/` 就能自动发现，不需要手写集中式路由注册表。

每次保存文件或修改配置，Zhin 都会在后台完整构建一个新的 **Generation（代）**：
- 新代码有语法错误或连接失败时，自动丢弃候选代，**旧版本继续无感服务**；
- 正在处理的在途消息持有旧代租约跑完，新消息走新代，不会出现“半新半旧”；
- 绑定在 `context.lifecycle` 上的定时器、监听器和长连接随旧代自动清理，彻底告别热重载导致的“幽灵定时器”和内存泄漏。

详见 [插件模型](./plugin-model.md) 与 [Generation 与生命周期](./generation-lifecycle.md)。

### 2. 写一次 JSX，在 20+ 个 IM 平台自动降级

各平台的富媒体能力差异巨大（Discord/Telegram 有原生按钮，普通群聊只有纯文本，有的平台适合发长图）。在 Zhin 中，命令和组件直接返回 JSX：

```tsx
return (
  <card title="部署确认">
    <text>即将发布 v1.2.0 到生产环境</text>
    <button onClick={async (msg) => '✅ 已开始部署'}>立即发布</button>
  </card>
);
```

- **原生交互与自动降级**：支持原生按钮的平台直接渲染交互键盘；不支持按钮的纯文本群聊自动降级为编号菜单（回复数字即触发同一个 `onClick` 回调，且仅在当前会话与当前 Generation 有效）。
- **HTML 转高清图片**：写在 `<html>...</html>` 边界内的样式组件（`@zhin.js/components`）会自动经 `@zhin.js/html-renderer` 渲染为图片发出。

### 3. 统一的收发管道与多账号（Multi-Endpoint）路由

不管底层连接的是 QQ（ICQQ / NapCat / OneBot 11·12 / 官方 Bot）、Discord、Telegram、飞书、钉钉、Slack、KOOK、企业微信还是本地 `/sandbox`：

- **同一套消息与会话模型**：插件永远面对统一的 `Message`、`Segment` 和结构化会话引用 `ConversationRef`。
- **单向可审计管道**：所有回复（`message.$reply` 或命令返回值）都经过 `渲染 → 出站中间件 → 平台投递`，审计、敏感词过滤和限流无需按平台重写。
- **1:N 多账号展开**：同一个适配器下在 `zhin.config.yml` 里配多个 `endpoints: [{ id: ... }]`，就能让多个机器人账号同时在线、各自独立收发。

详见 [消息流](./message-flow.md) 与 [配置即数据](./config-as-data.md)。

### 4. 轻量 IM 核心（<10MB）+ 按需装配的受控 AI Agent

Zhin 默认只安装纯 IM 核心（`node_modules` 生产体积 <10MB），不捆绑任何大模型 SDK。当你需要 AI 时，运行 `npx zhin setup --ai` 即可按需装配 `@zhin.js/agent`：

- **多模型与多用途路由**：通过 `ai.plan.yml` 与 Console 为聊天（`chat`）、摘要压缩（`compaction`）、旁听判断（`ambient`）、识图（`perception`）分别指定最合适的模型（OpenAI、DeepSeek、通义千问、硅基流动、火山引擎、Anthropic、本地 Ollama 等）。
- **渐进式工具与技能披露**：工具与 `SKILL.md` 按场景分档、按需加载，保持系统提示词前缀字节级稳定，最大化命中模型厂商的 Prompt Cache。
- **权限分级与危险操作硬闸**：群成员、受信用户与主人的工具权限严格隔离；踢人、禁言、发公告、修改配置等危险动作必须经过人工硬闸审批（Console 卡片或主人私聊 `/approve`），旁听合流与 Token 预算让机器人在高热群聊里既像真人又养得起。

详见 [AI 能力总览](../ai/index.md) 与 [Agent 深入](../ai/agent.md)。

## 一张图看懂运行时分工

```text
            ┌────────────────────── 平台（QQ / OneBot / Discord / 飞书 / …）─────────────────┐
            │                                                                                │
  适配器 ── 声明能力画像（支持哪些段、动作与交互）── 实现端口 ── 映射平台原始事件为标准事件  │
            │                                                                                │
            ▼                                                                                │
  Zhin 运行时 ─ 规范：Generation 事务 · 消息与组件渲染 · 能力协商 · 审计 · 危险动作硬闸      │
            │                                                                                │
            ▼                                                                                │
  插件 / Agent ─ 只写业务逻辑：命令、JSX 组件、中间件、AI 工具与技能 ────────────────────────┘
```

分工原则：**Zhin 提供统一契约；适配器声明平台能力；插件和 Agent 按当前回合组合出的能力工作**，核心代码里不写死任何「如果是某平台就……」。

## 一条消息经历了什么

1. **入站归一化**：适配器把平台消息转成标准 `Message`，补齐发送者角色与群场景信息。
2. **能力协商**：按会话类型（群聊 / 私聊 / 频道）和 Bot 当前状态（是否管理员、是否被禁言）收窄本回合可用能力。
3. **中间件与命令分发**：先走入站中间件；命中命令前缀时执行对应命令，未命中时按 `ai.trigger` 规则决定是否交给 AI Agent。
4. **AI 推理与工具调用**（启用 AI 时）：组装稳定前缀提示词与历史窗口；模型在当前权限允许的工具集中调用工具，高危动作触发硬闸审批。
5. **出站渲染与投递**：JSX、组件或 AI 结构化回复统一转换为消息段，按目标平台能力渲染或自动降级，经出站中间件投递到对应账号。

## 下一步读哪里

- **动手写第一个插件**：[快速上手](../getting-started/index.md) → [目录约定](../authoring/conventions.md) → [插件模型](./plugin-model.md)
- **接入大模型与写工具**：[AI 能力总览](../ai/index.md) → [Agent 工具与技能](../authoring/agent-tools.md)
- **理解热重载与配置事务**：[配置即数据](./config-as-data.md) → [Generation 与生命周期](./generation-lifecycle.md)
- **编写新平台适配器**：[适配器编写](../authoring/adapters.md)

::: details 架构决策记录索引（ADR）

以下是支撑上述群聊体验、受控运维、Token 预算与适配器能力画像的内部架构决策记录（ADR），供深入了解设计背景或参与框架贡献时查阅：

| ADR | 主题 | 核心机制 |
|---|---|---|
| [0034](../adr/0034-activity-feedback-service-plugin.md) | 执行状态反馈服务 | 在聊天里展示正在输入、表情回应或进度消息 |
| [0035](../adr/0035-comment-reply-adapter-contract.md) | 评论回复适配器契约 | 评论类平台的入站/出站标准契约 |
| [0036](../adr/0036-controlled-landing-phase0.md) | 受控落地第 0 期：审计、控制面、硬闸 | 决策审计回放、急停/静音控制面、危险动作新鲜人工审批 |
| [0037](../adr/0037-controlled-landing-phase1-group-ops.md) | 第 1 期：群运营闭环 | 入群欢迎、公告审批、冷场降噪、日程提醒、群管冷却 |
| [0038](../adr/0038-continuous-input-merge.md) | 连续输入合流（高热群、弹幕） | 多人同时 @ 合并一次回复、直播弹幕窗口挑选 |
| [0039](../adr/0039-group-ops-rules.md) | 动态群管规则 | 群主批准违规阶梯后禁言自动执行，踢人仍逐次审批 |
| [0040](../adr/0040-controlled-self-change.md) | 受控自我进化 | Agent 起草变更 → 沙箱试跑 → 人工审批 → 生效与自动回滚 |
| [0041](../adr/0041-prompt-segments-and-message-headers.md) | 提示词分段组装与消息头 | 系统提示词五段稳定前缀、按需展示发言者消息头与群事件 |
| [0042](../adr/0042-first-turn-token-budget.md) | 压低首轮 Token | 缓存断点、工具按场景分档与按名自动加载、`SOUL.md` 作用域标注 |
| [0043](../adr/0043-history-token-budget.md) | 历史 Token 预算与引用消息 | 历史只存对话、按 Token 预算滑窗、旧工具结果裁剪、引用内联 |
| [0044](../adr/0044-adapter-capability-profile.md) | 适配器能力画像 | 七组平台能力声明、动态收窄、OneBot 事件共享映射 |
| [0045](../adr/0045-current-message-runtime-context.md) | 当前消息运行时上下文后置 | 将本轮动态上下文放在正文之后以保护提示词缓存 |
| [0046](../adr/0046-personal-session-model-policy.md) | 个人 Session、模型目录与作用域策略 | 个人会话隔离、模型 Profile 路由与分层覆盖 |

0036–0040 的整体规划见[受控落地路线图](https://github.com/zhinjs/zhin/blob/main/docs/plans/controlled-ops-roadmap.md)。
:::
