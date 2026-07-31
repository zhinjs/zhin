# AI Agent Path (~Half a Day)

Goal: a bot that can have AI conversations, call tools, and remember things. It is recommended to complete the [IM Bot Path](./im-bot.md) first.

## 1. Install AI (2 minutes)

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # Or deepseek / anthropic / google, depending on your provider
```

zhin defaults to an IM-only framework (<10MB) -- AI is **added only when installed**, and not installing it does not affect any IM functionality.

## 2. Configure a Provider (5 minutes)

```yaml
# zhin.config.yml
ai:
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}        # Real values go in .env
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

After restarting, direct messages to the bot become AI conversations; in group chats, `@bot` or the `ai:` prefix triggers it.

**Local models**: `sdk: ollama` + `host: http://localhost:11434`, zero cloud cost
(see the [Personal Assistant showcase](../showcase/personal-assistant.md)).

## 3. Give the AI a Tool (20 minutes)

Create `weather.ts` in `agent/tools/`:

```ts
import { defineAgentTool } from '@zhin.js/agent/tools'
import { z } from 'zod'

export default defineAgentTool({
  name: 'weather',
  description: 'Query real-time weather for a city',
  inputSchema: z.object({ city: z.string().describe('City name') }),
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`)
    return res.text()
  },
})
```

After hot-reload, tell the bot "check the weather in Hangzhou" -- the AI will discover and call this tool on its own.
(Tools go into the deferred catalog by default; the model uses `discover`/`load_tool` to load them on demand, without occupying context.)

## 4. Memory (10 minutes)

Three-layer Markdown memory works out of the box, no configuration needed:

| Layer | Location | What It Remembers |
|-------|----------|-------------------|
| Global | `data/memory/global/` | Your preferences, long-term facts |
| Platform | `data/memory/platforms/<platform>/` | Platform rules, group rules |
| Session | `data/memory/sessions/<id>/` | Context of this conversation |

Just tell the bot "remember I don't eat cilantro" and it will write it to memory; it will still remember in new sessions.

## 5. Multi-Provider Routing (Advanced, Optional)

Different roles use different models -- cheap ones for casual chat, expensive ones for reviews:

```yaml
ai:
  agents:
    zhin:       { provider: openrouter, model: openrouter/free }
    reviewer:   { provider: openai-main, model: gpt-4o, nickname: 'Niuniu' }
```

## What You Now Know

- AI = install packages + `ai:` config; IM part requires zero changes
- Tools = files under `agent/tools/`; AI discovers and calls them on its own
- Memory = hands-off; three layers are written automatically

## Next Steps

- Tools need to access local files/commands -> Read [Agent Authoring Surface & Security Policies](../authoring/agent-tools.md) (allowlists and approvals)
- Want to connect MCP services -> `ai.mcpServers` config
- Want to manage multiple bots in a browser -> [Console Management Path](./console.md)
