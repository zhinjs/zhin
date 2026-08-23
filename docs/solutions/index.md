# 从问题选解决方案

不需要先理解 Zhin 的包结构。先选择你想交付的结果，每条路径都从可运行的最小系统开始，再按需要增加能力。

| 你想做什么 | 从这里开始 | 完成标志 |
| --- | --- | --- |
| 做一个能收发消息的 Bot | [IM Bot 学习路径](/paths/im-bot) | Sandbox 与目标平台共用同一条命令/消息链 |
| 让 Bot 理解自己的业务 | [给 Agent 添加受治理上下文](/authoring/agent-tools#让插件给-agent-补充上下文) | Prompt Section 进入当前 generation，可在 Console 验证 |
| 组合工具、MCP、技能与子 Agent | [AI Agent 学习路径](/paths/ai-agent) | Agent 只看到当前回合有权使用的能力 |
| 运营和排查已部署的 Bot | [Console 管理路径](/paths/console) | 能查看 Endpoint、日志、能力目录和 Agent 运行状态 |
| 用多个账号稳定运营同一套业务 | [多 Endpoint 运营](/solutions/multi-endpoint-operations) | 每个账号可独立诊断，业务能力仍只维护一份 |
| 让 Agent 理解业务但不越权 | [受治理的业务 Agent](/solutions/governed-agent) | Prompt、Tool、审批和执行策略各自可审计 |
| 把一个 GitHub 仓库作为协作空间 | [GitHub 仓库 Workroom](/solutions/github-workroom) | 仓库事件进入正确 Project，任务投影边界明确 |
| 做个人日程、提醒与语音助手 | [个人生活助手](/showcase/personal-assistant) | 消息、定时任务、语音与主动通知组成闭环 |
| 做多平台社区 Bot | [多平台社区 Bot](/showcase/community-bot) | 业务命令与组件不绑定某个适配器 |

## 推荐的实施顺序

1. 先在 Sandbox 建立可重复的黄金路径。
2. 再连接一个真实平台，保持业务代码不感知适配器。
3. 需要模型时再开启 AI，将提示词、工具和权限分开治理。
4. 用 Console 验证实际发布的 generation，不以配置文件的期望状态代替运行时事实。

如果你还没有项目，从 [快速开始](/getting-started/) 用默认的 IM 黄金路径创建。
