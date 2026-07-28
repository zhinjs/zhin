# 学习路径

zhin 可以只用 IM、也可以一路用到全功能 Agent——按你的目标选一条路，
每条路只接触必要的概念，走通了再换。

| 路径 | 适合 | 预计 | 终点 |
|------|------|------|------|
| [IM Bot 路径](./im-bot.md) | 我只要命令/通知机器人，不要 AI | ~1 小时 | 命令 + 适配器上线 |
| [AI Agent 路径](./ai-agent.md) | 我要能对话、会调工具的 AI 助手 | ~半天 | AI 对话 + 工具 + 记忆 |
| [Console 管理路径](./console.md) | 我要在浏览器里管 bot / 多账号 | ~1 小时 | Console 管全部 endpoint |

三条路互相独立，但都从同一步开始：

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```
