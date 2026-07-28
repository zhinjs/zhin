# AI Agent 路径（约半天）

目标：bot 能 AI 对话、会调工具、记得住事。建议先走完 [IM Bot 路径](./im-bot.md)。

## 1. 装 AI（2 分钟）

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 或 deepseek / anthropic / google，按厂商选
```

zhin 默认只是 IM 框架（<10MB）——AI 是**装上才有**的，不装不影响任何 IM 功能。

## 2. 配 provider（5 分钟）

```yaml
# zhin.config.yml
ai:
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}        # 真实值放 .env
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

重启后，私聊 bot 直接说话就是 AI 对话；群聊里 `@bot` 或 `ai:` 前缀触发。

**本地模型**：`sdk: ollama` + `host: http://localhost:11434`，零云成本
（参考 [个人生活助手案例](../showcase/personal-assistant.md)）。

## 3. 给 AI 一件工具（20 分钟）

在 `agent/tools/` 新建 `weather.ts`：

```ts
import { defineAgentTool } from '@zhin.js/agent/tools'
import { z } from 'zod'

export default defineAgentTool({
  name: 'weather',
  description: '查询城市实时天气',
  inputSchema: z.object({ city: z.string().describe('城市名') }),
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`)
    return res.text()
  },
})
```

热重载后对 bot 说"查一下杭州天气"——AI 会自己发现并调用这个工具。
（工具默认进 deferred catalog，模型用 `discover`/`load_tool` 按需装载，不占上下文。）

## 4. 记忆（10 分钟）

三层 Markdown 记忆开箱即用，无需配置：

| 层 | 位置 | 记什么 |
|----|------|--------|
| 全局 | `data/memory/global/` | 你的偏好、长期事实 |
| 平台 | `data/memory/platforms/<platform>/` | 平台规则、群规 |
| 会话 | `data/memory/sessions/<id>/` | 这次对话的上下文 |

直接对 bot 说"记住我不吃香菜"，它会写进记忆；新会话里它还记得。

## 5. 多 provider 分流（进阶，可选）

不同角色用不同模型——便宜的做闲聊，贵的做评审：

```yaml
ai:
  agents:
    zhin:       { provider: openrouter, model: openrouter/free }
    reviewer:   { provider: openai-main, model: gpt-4o, nickname: '妞妞' }
```

## 你现在已经会的

- AI = 装包 + `ai:` 配置，IM 部分零改动
- 工具 = `agent/tools/` 下的文件，AI 自己发现调用
- 记忆 = 不用管，三层自动写

## 下一步

- 工具要调本地文件/命令 → 读 [Agent 创作面与安全策略](../authoring/agent-tools.md)（白名单与审批）
- 想接 MCP 服务 → `ai.mcpServers` 配置
- 想在浏览器里管多个 bot → [Console 管理路径](./console.md)
