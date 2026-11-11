# Run your first Bot in 10 minutes

This page takes you from zero to a running Zhin Bot, then shows how to drop parameterized commands, cross-platform JSX interactive cards, and AI tools straight into your project (the 1 → 2 jump). No platform account or model key is required.

> Not sure what Zhin.js is for yet? Spend 5 minutes on [What is Zhin.js](./introduction.md) first.

## Before you start

- Node.js `>=22.19.0`, for scaffolded projects and the compiled IM library alike (`@zhin.js/ai` depends on undici 8, which needs it).
- pnpm 9 or newer.

## 1. Create and start

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` accepts every default: only the Sandbox adapter (a simulated chat window in the browser), the HTTP service, one `/hello` command, and no AI. Drop `-y` to pick a real platform, database, or AI in the wizard — or add them later with `npx zhin setup`.

## 2. Open the debug UI and verify

The startup output prints the API Base. New projects default to `http://127.0.0.1:8068` (always trust the terminal output or `http.port` in `zhin.config.yml`). Pick either way to test:

- **Option A: Local built-in Sandbox (instant, zero setup)**
  Open `http://127.0.0.1:8068/sandbox` directly in your browser, send `/hello`, and see the reply immediately.
- **Option B: Remote Console (full admin & debugging UI)**
  1. Open [console.zhin.dev](https://console.zhin.dev).
  2. Enter the API Base printed by the Host (e.g. `http://127.0.0.1:8068`).
  3. Use `HTTP_TOKEN` from the project `.env` file (when the project is created, the terminal masks the token so it stays out of CI logs).
  4. Open **Bot → Try a chat** (Sandbox) in the sidebar and send `/hello`.

A reply means the whole pipeline works: the Sandbox adapter received the inbound message → matched `commands/hello` → sent the reply back through the unified outbound pipeline. Connecting a real platform later just mounts that platform's adapter in config.

## 3. Know the generated project

To discover loaded commands at any time, send **`/菜单`** in the conversation (`菜单` if no command prefix is configured). It lists the root plugin's commands and child plugins; use `/hello --help` for a command's usage (see [Browse loaded commands](../authoring/commands.md#browse-loaded-commands)).

```text
my-bot/
├── package.json          # Runtime topology: entry, features
├── zhin.config.yml       # Host, mounted plugin instances (plugins), and plugin settings
├── .env                  # token, platform credentials, model keys
├── plugin.ts             # root plugin entry
├── commands/             # file paths define command routes
├── components/           # reusable message components
└── pages/                # Console pages contributed by the plugin
```

Two things are enough for now:

- **The `zhin` field in `package.json` declares the plugin's own entry and capability Features** (`entry`, `features`); **`zhin.config.yml` declares which plugins are mounted and how everything is configured** (`plugins`, port, credentials, per-plugin settings). Secrets go in `.env`.
- **`my-bot` is already a Root plugin** — files placed in convention folders (`commands/`, `components/`, `middlewares/`, `pages/`) register themselves automatically without touching `package.json` or `plugin.ts`.

Full definitions: [Core concepts at a glance](./concepts.md).

## 4. Observe hot reload — Add features directly to your Bot (1→2) {#hot-reload}

Change the reply in `commands/hello/index.ts`, save it, and send `/hello` again — the new reply appears without a restart. Messages already in flight finish on the old code; if the new code throws an error, the previous version keeps serving and the terminal prints the cause.

Because `my-bot` is already a Root plugin, you don't need to create a separate child plugin package for everyday features — just drop files into convention directories:

### ① Add a command with parameters (`commands/roll/index.ts`)

Create `commands/roll/index.ts`, save, and send `/roll 20` or `/roll --help` in Sandbox:

```ts
// commands/roll/index.ts  →  /roll [sides]
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Roll a die with N sides',
  params: {
    sides: { type: 'integer', min: 2, max: 100, default: 6 },
  },
  execute: ({ params }) => `🎲 (1-${params.sides}) Rolled: ${1 + Math.floor(Math.random() * params.sides)}`,
});
```

### ② Add a cross-platform JSX interactive card (`commands/card/index.tsx`)

Create `commands/card/index.tsx` (note the `.tsx` extension). Platforms with native buttons render interactive buttons; plain-text platforms automatically degrade them to numbered choices and route replies back to `onClick`:

```tsx
// commands/card/index.tsx  →  /card
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Send an interactive status check-in card',
  execute: () => (
    <card title="⚡ Daily Check-in">
      <text>How is your energy today?</text>
      <button label="🔥 Fully charged" onClick={(msg) => `${msg.$sender.name} checked in: Fully charged!`} />
      <button label="☕ Need coffee" onClick={(msg) => `${msg.$sender.name} is refueling on coffee…`} />
    </card>
  ),
});
```

### ③ Add an AI tool (`tools/weather/index.ts`, optional)

Once AI is enabled via `npx zhin setup --ai`, create `tools/weather/index.ts` so the LLM can call it automatically:

```ts
// tools/weather/index.ts
import { Schema } from 'zhin.js';
import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool<{ city: string }>({
  description: 'Get live weather for a city',
  parameters: Schema.object({
    city: Schema.string().required().description('City name, e.g. Shanghai'),
  }),
  requiresApproval: 'never',
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    return res.text();
  },
});
```

## Troubleshooting

```bash
npx zhin doctor
```

Doctor checks Node, pnpm, ports, `HTTP_TOKEN`, CORS, and the project manifest. When Console cannot connect, check the API Base printed by this project instead of assuming a default port.

## Choose the next outcome

| Need | Shape | Continue with |
| --- | --- | --- |
| Validate an idea | one `bot.ts` file | [Examples](../examples/) |
| Build commands, cards, and notifications | Root plugin + convention directories | [IM Bot path](../paths/im-bot.md) |
| Extract a reusable / publishable plugin package | `plugins/<name>` child plugin | [First plugin](./first-plugin.md) |
| Add models and tools | Agent Features | [AI Agent path](../paths/ai-agent.md) |
| Operate multiple accounts | HTTP Host + Remote Console | [Console path](../paths/console.md) |

## Install tiers

<!--@include: ../../snippets/install-tiers.md#tiers-table-en-->

## Next steps

1. [Core concepts at a glance](./concepts.md): learn the recurring terms once.
2. [First plugin](./first-plugin.md): learn how to extract a reusable sub-plugin package with its own config schema to share across bots or publish to npm.
3. [Adapters](../adapters/index.md): connect a real platform with `npx zhin setup --adapters`.
4. [AI overview](../ai/index.md): add an LLM with `npx zhin setup --ai`.
