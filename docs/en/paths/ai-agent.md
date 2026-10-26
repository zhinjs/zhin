---
title: "AI Agent path: give your bot an AI that uses tools"
description: "Connect a model to an existing IM bot, write a custom tool, add business context, and learn the memory and permission boundaries. About half a day"
---

# AI Agent path: give your bot an AI that uses tools

This path connects a large language model to an existing bot: when a user messages it privately or starts with `ai:`, the AI replies and can call tools you write (such as a weather lookup). Finish the [IM Bot path](./im-bot.md) first.

When you're done you'll have:

- model replies in private chat or after an `ai:` prefix;
- a custom tool the AI calls on its own;
- a piece of business context that only the AI sees;
- a clear picture of what the AI can do itself and what permission policy must allow.

## 1. Install the AI components with the wizard

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

The wizard asks which model service to use. Cloud API keys go into `.env`; choose Ollama to run a local model with no keys at all.

::: tip Use the wizard, not just `@zhin.js/agent`
Besides the model SDK, the wizard mounts two feature plugins: `@zhin.js/tool` (discovers the `tools/` directory) and `@zhin.js/prompt-section` (discovers `prompt-sections/`). If you only install `@zhin.js/agent` by hand, the files from the next steps are never loaded.
:::

## 2. Look at the generated model config

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

- `providers` says *how to reach* a model service: SDK type and key;
- `agents` says *which model replies*: it binds an Agent (here `zhin`) to a model on a provider.

After a restart, private messages to the bot are answered by the AI. In groups and channels, start the message with `ai:`, `AI:`, or `#`, or @-mention the bot (where the platform supports it).

## 3. Write a tool

Create `tools/weather/index.ts`:

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ city: string }>({
  description: 'Get current weather for a city',
  inputSchema: z.object({ city: z.string().min(1) }),
  requiresApproval: 'never',
  async execute({ city }) {
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=3`,
    );
    return response.text();
  },
});
```

Save, then ask the bot privately: "What's the weather in Shanghai?" The AI decides to call the tool and uses its result in the reply.

- The tool name comes from the file path (`weather` here); `description` and `inputSchema` tell the model when to use it and what to pass;
- `requiresApproval: 'never'` means no human confirmation. Tools that change data should require approval;
- Tools aren't visible to everyone: Zhin filters by the current user's permissions, platform, group or private chat, and approval policy before handing a tool to the model.

See [Agent Tools and Skills](../authoring/agent-tools.md) for more.

## 4. Give the AI business context

Create `prompt-sections/product-language/index.ts`:

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

A Prompt Section is text injected into the AI's system prompt — product terms, answer style, and other background. It **only shapes what the AI says and grants no permissions**: writing "you may read every file" does not give the AI file access.

Changes apply on save: conversations that start afterwards read the new text, while one already in progress keeps the old text instead of switching halfway.

## 5. Know where memory lives

The AI reads three layers of Markdown memory files:

| Layer | Path | Appropriate content |
| --- | --- | --- |
| Deployment | `data/memory/global/` | durable product facts and preferences |
| Platform | `data/memory/platforms/<platform>/` | platform rules and constraints |
| Session | `data/memory/sessions/<hash>/` | current conversation notes |

Readable doesn't mean writable: only the bot owner (Endpoint Owner) can have the AI write global or platform memory; ordinary conversations can only write session notes.

::: warning Upgrading from an older version
Only the three directories above are valid. Root-level legacy files such as `data/memory/MEMORY.md` are neither read nor migrated automatically; move anything you want to keep into the right directory before upgrading.
:::

## 6. Accept the result in Console

1. Check provider, binding, and runtime state in **Bot status**.
2. In **Runtime Capabilities**, confirm the `weather` tool and the `product-language` Prompt Section are loaded from your project.
3. Start a request in **Chat accounts** and inspect each step and the tool result in **Bot status**.
4. Edit the Prompt Section, save, and confirm a new conversation reads the new text.

## Security rules

In one sentence: **the prompt describes intent, tools provide capability, and permission policy decides what's allowed.**

- "I'm an admin" or "the working directory is /" in a user message or prompt changes nothing; the runtime decides the working directory and shell policy for each turn.
- To use external MCP tools, declare the server in `ai.mcpServers`, then assign it to an Agent in `agents.<name>.mcpServers`.

::: details What if a Prompt Section doesn't fit?
Each turn has a prompt budget. A section with `retention: 'required'` that doesn't fit fails the turn explicitly rather than being silently truncated; `opportunistic` and then `preferred` sections give up their space first.
:::

## Next steps

- [Agent Tools and Skills](../authoring/agent-tools.md): tool approval, Skills, and sub-agents in full
- [MCP configuration](../configuration/#mcpservers-external-mcp-servers): connect external MCP tool servers
- [Agent deep dive](../ai/agent.md): how a turn runs, how to cancel it, and multi-Agent Workrooms
