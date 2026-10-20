---
title: "按问题选方案"
description: "不用先理解包结构：按你想交付的结果，找到对应的上手路径或方案页"
---

# 按问题选方案

不需要先理解 Zhin 的包结构。在下表中找到你想做成的事，每条路径都从一个能跑的最小系统开始，再按需要加能力。

| 你想做什么 | 从这里开始 | 完成标志 |
| --- | --- | --- |
| 做一个能收发消息的 Bot | [IM Bot 学习路径](/paths/im-bot) | Sandbox 与目标平台共用同一条命令/消息链 |
| 不启用 AI 也能设置提醒 | [用自然时间创建个人提醒](/solutions/reminders) | 确认明确日期、时区与内容后，提醒持久保存到原会话 |
| 把订阅更新发到指定会话 | [管理员 RSS 订阅](/solutions/rss-subscriptions) | 首次建立基线后，新文章送到完整目标，任务可暂停与取消 |
| 让 Bot 理解自己的业务 | [给 AI 补充业务背景](/authoring/agent-tools#给-ai-补充业务背景) | 在 Console 能力目录中能看到你的 Prompt Section 已生效 |
| 组合工具、MCP、技能与子 Agent | [AI Agent 学习路径](/paths/ai-agent) | Agent 只看到当前回合有权使用的能力 |
| 运营和排查已部署的 Bot | [Console 管理路径](/paths/console) | 能查看 Endpoint、日志、能力目录和 Agent 运行状态 |
| 用多个账号稳定运营同一套业务 | [用多个账号运营同一套业务](/solutions/multi-endpoint-operations) | 每个账号可独立诊断，业务能力仍只维护一份 |
| 让 Agent 理解业务但不越权 | [让 Agent 懂业务，但不越权](/solutions/governed-agent) | Prompt、Tool、审批和执行策略各自可审计 |
| 把一个 GitHub 仓库作为协作空间 | [把 GitHub 仓库作为 Workroom](/solutions/github-workroom) | 仓库事件进入正确的项目，任务状态以 Workroom 为准 |
| 做个人日程、提醒与语音助手 | [个人生活助手](/showcase/personal-assistant) | 消息、定时任务、语音与主动通知组成闭环 |
| 做多平台社区 Bot | [多平台社区 Bot](/showcase/community-bot) | 业务命令与组件不绑定某个适配器 |

## 推荐的实施顺序

1. 先在 Sandbox 里把最简单的流程跑通。
2. 再连接一个真实平台，保持业务代码不感知适配器。
3. 需要模型时再开启 AI，将提示词、工具和权限分开治理。
4. 用 Console 确认实际运行的状态，而不是只看配置文件写了什么。

## 下一步

- 还没有项目？先看 [快速开始](/getting-started/)
- 想看完整的例子？见 [示例项目](/examples/) 和 [真实部署案例](/showcase/README)
