# Add a governed Agent to an IM Bot

Goal: add models, tools, and plugin context to an existing message path while keeping authority, Prompt, and Runtime generation observable. Complete the [IM Bot path](./im-bot.md) first.

## Done means

- A private message or `ai:` prefix triggers a model reply.
- The Agent discovers and calls a generation-owned Tool.
- A Prompt Section appears in Console without exposing its content.
- File, command, and network authority comes from policy, never the Prompt.

## 1. Install the complete AI topology

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

The wizard installs a model SDK and mounts the `@zhin.js/tool` and `@zhin.js/prompt-section` Features. Installing `@zhin.js/agent` alone does not create the complete discovery topology.

Cloud model keys belong in `.env`. Ollama is available for local models without cloud credentials.

## 2. Check the provider and Agent binding

```yaml
ai:
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

`providers` define connections. `agents` bind roles to a provider and model. Private messages trigger the Agent by default; groups and channels can use `ai:`, `AI:`, `#`, or a trusted mention supplied by the Adapter.

## 3. Declare a Tool

Create `tools/weather.ts`:

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ city: string }>({
  description: 'Get current weather for a city',
  inputSchema: z.object({ city: z.string().min(1) }),
  approval: 'never',
  async execute({ city }) {
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=3`,
    );
    return response.text();
  },
});
```

The file path supplies the local name. The Tool enters the generation catalog, then turn authority, platform, scene, and approval policy decide whether the model can see it.

## 4. Add plugin-owned context

Create `agent/prompt-sections/product-language.ts`:

```ts
import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'Product language',
  content: 'Use Workroom for a governed collaboration space.',
  layer: 'context',
  order: 70,
  retention: 'preferred',
  profiles: ['interactive'],
});
```

The section is pinned to a generation. New turns see the hot-reloaded version; an in-flight turn keeps its old snapshot. A Prompt Section changes context and grants no Tool, file, or network authority.

## 5. Understand memory boundaries

Three Markdown memory layers are read by default:

| Layer | Path | Appropriate content |
| --- | --- | --- |
| Deployment | `data/memory/global/` | durable product facts and preferences |
| Platform | `data/memory/platforms/<platform>/` | platform rules and constraints |
| Session | `data/memory/sessions/<hash>/` | current conversation notes |

Loading memory does not grant write access. Writes still pass through Turn file policy and Tools. Global and platform memory are owner-only; normal conversations use session notes.

## 6. Accept the result in Console

1. Check provider, binding, and runtime state in **Agent Overview**.
2. Inspect Tool and Prompt Section owner, source, and generation in **Runtime Capabilities**.
3. Start a request in **Conversations & Channels** and inspect its steps and Tool results.
4. Reload the Prompt Section and verify an old turn is not contaminated.

## Security rules

- Prompt describes intent, Tool Feature provides capability, Host policy grants authority.
- A `required` Prompt Section fails explicitly when it cannot fit the budget.
- Declare MCP Servers in `ai.mcpServers`, then assign them through `agents.<name>.mcpServers`.
- Working directory and shell policy belong to the Turn and cannot be self-declared in user text.

## Next

- Tool, Prompt, and execution policy: [Agent authoring and safety](../authoring/agent-tools.md)
- External tool protocol: [MCP configuration](../configuration/#mcpservers-external-mcp-server)
- Governed multi-Agent collaboration: [Workroom Kernel](../ai/agent.md#workroom-kernel)
