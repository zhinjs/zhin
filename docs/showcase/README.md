---
title: "真实部署案例"
description: "两个基于仓库示例的部署故事：为什么选 Zhin、怎么部署、关键配置和踩过的坑"
---

# 真实部署案例

想知道 Zhin 适不适合你，看别人怎么用往往比读架构文档更快。每个案例都讲四件事：为什么选 Zhin、怎么部署、关键配置、踩过的坑。

| 案例 | 场景 | 平台 | AI | 对应示例 |
|------|------|------|----|--------|
| [个人生活助手](./personal-assistant.md) | 私人助理：定时提醒 + 查笔记 + 聊天，数据不出本机 | Sandbox（可加任意聊天平台） | Ollama 本地模型 | `life-assistant-bot` |
| [多平台社区 Bot](./community-bot.md) | 一个进程管 5 个 QQ 号 + QQ 官方 + Slack + GitHub | icqq / qq / slack / github | OpenRouter 免费模型 | `test-bot` |

每个案例都对应仓库里能直接运行的示例；配置片段已脱敏，密钥用 `${ENV}` 占位。

## 下一步

- [示例项目](../examples/index.md)：先在本地跑起一个示例
- [学习路径](../paths/README.md)：按目标选一条上手路线
