---
title: "Showcase"
description: "Two deployment stories based on repo examples: why they chose Zhin, how they deployed, key config, and lessons learned"
---

# Showcase

To judge whether Zhin fits you, seeing how others use it is often faster than reading architecture docs. Each story covers four things: why Zhin, how it's deployed, key configuration, and the pitfalls hit along the way.

| Story | Scenario | Platforms | AI | Example |
|------|------|------|----|--------|
| [Personal assistant](./personal-assistant.md) | A private assistant: reminders + note search + chat, data stays on your machine | Sandbox (add any chat platform) | Ollama local model | `life-assistant-bot` |
| [Multi-platform community bot](./community-bot.md) | One process running 5 QQ accounts + QQ Official + Slack + GitHub | icqq / qq / slack / github | OpenRouter free model | `test-bot` |

Every story maps to an example you can run from the repo; config snippets are sanitized, with secrets as `${ENV}` placeholders.

## Next steps

- [Example projects](../examples/index.md): run an example locally first
- [Learning paths](../paths/README.md): pick a getting-started route by goal
