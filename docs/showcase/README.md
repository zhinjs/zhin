# 真实部署案例（Showcase）

案例比架构文档更能说明 zhin 适不适合你。这里收集真实部署故事：
为什么选 zhin、怎么部署、关键配置、踩过的坑。

| 案例 | 场景 | 平台 | AI | 关键词 |
|------|------|------|----|--------|
| [个人生活助手](./personal-assistant.md) | 私人助理：定时提醒 + 知识库 + 对话 | Sandbox（可加任意 IM） | Ollama 本地模型 | `life-assistant-bot` |
| [多平台社区 Bot](./community-bot.md) | 一个进程管 5 个 QQ 号 + QQ 官方 + Slack + GitHub | icqq / qq / slack / github | OpenRouter 免费模型 | `test-bot`（维护者厨房水槽） |

每个案例都基于仓库内可直接运行的示例，配置片段已脱敏（`${ENV}` 占位）。
