# Real-World Deployment Showcase

Showcases speak louder than architecture docs when deciding if zhin is right for you. Here we collect real deployment stories:
why zhin was chosen, how it was deployed, key configuration, and lessons learned.

| Showcase | Scenario | Platforms | AI | Keywords |
|----------|----------|-----------|-----|----------|
| [Personal Assistant](./personal-assistant.md) | Private assistant: scheduled reminders + knowledge base + chat | Sandbox (can add any IM) | Ollama local model | `life-assistant-bot` |
| [Multi-Platform Community Bot](./community-bot.md) | One process managing 5 QQ accounts + QQ Official + Slack + GitHub | icqq / qq / slack / github | OpenRouter free model | `test-bot` (maintainer kitchen sink) |

Every showcase is based on a directly runnable example from the repo, with sanitized config snippets (`${ENV}` placeholders).
