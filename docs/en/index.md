---
layout: home
---

<ZhinHero tagline="Write once in TypeScript. Run your bot on QQ, WeChat, Lark, DingTalk, Discord, Telegram, and 20+ chat platforms. File-based commands, cross-platform JSX cards, leak-free hot reload, and opt-in AI agents — managed from the browser." />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot -y && cd my-bot && pnpm dev<br>
<span>✔ Bot started — open http://127.0.0.1:8068/sandbox to chat immediately (no account or model key needed)</span>
</ZhinTerminal>

<ZhinRolePaths heading="Where do you want to start?" intro="You don't need to learn the whole architecture upfront. Pick a goal — each path fits in one sitting." :items="[
  { eyebrow: 'STEP 1 · 30s RUN', title: 'Run your first bot', description: 'Zero platform accounts or API keys — get your first reply in the local /sandbox or Remote Console.', href: '/en/getting-started/', action: '10-min Quick Start' },
  { eyebrow: 'STEP 2 · BUILD', title: 'Write commands, cards & AI tools', description: 'Commands, cross-platform JSX button cards, middleware, cron jobs, and AI tools — drop a file in a folder and save to hot-reload.', href: '/en/authoring/define-plugin', action: 'Plugin Authoring' },
  { eyebrow: 'STEP 3 · SHIP', title: 'Connect platforms & go live', description: 'Run npx zhin setup --adapters for QQ / WeChat / Lark / Discord and deploy to production.', href: '/en/adapters/', action: 'Choose an adapter' },
  { eyebrow: 'NO-CODE · OPERATE', title: 'Operators & group owners', description: 'Read messages, edit form settings, configure welcomes & reminders, and approve risky actions in Console.', href: '/en/customer/', action: 'Operator Guide' },
]" />

<ZhinFeatureGrid heading="Why Zhin.js" :features="[
  { title: 'One codebase, 20+ platforms', desc: 'QQ, WeChat, WeCom, DingTalk, Lark, Discord, Telegram, Slack, KOOK, LINE… Your code sees one unified message; adapters handle platform differences.' },
  { title: 'A feature is a file', desc: '<code>commands/hello/index.ts</code> is the <code>/hello</code> command. Middleware, JSX components, schedules, and AI tools work the same way — zero registration boilerplate.' },
  { title: 'Generation-isolated hot reload', desc: 'Save to hot-reload. In-flight messages finish on the old version, and if new code throws on startup, the previous version keeps serving.' },
  { title: 'Develop with zero accounts', desc: 'Open <code>http://127.0.0.1:8068/sandbox</code> for an instant simulated chat window — build and test everything without a platform account or model key.' },
  { title: 'Managed in the browser', desc: 'Connect <code>console.zhin.dev</code> to your bot: send test messages, inspect logs, edit schema forms, and manage plugins with zero frontend deployment.' },
  { title: 'Opt-in AI (<10MB core)', desc: 'The default install is a lean IM core under 10MB. Run <code>npx zhin setup --ai</code> to add LLMs, tools, 3-layer memory, and MCP.' },
]" />

<ZhinDuo heading="What building with Zhin.js feels like">
<template #left>

**File-based command + Cross-platform JSX card** (`commands/poll/index.tsx`): renders native interactive buttons where supported, and automatically degrades to numbered text choices on plain-text platforms.

```tsx
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Start a quick poll',
  params: { topic: { type: 'text', default: 'Ship v1.2 today?' } },
  execute: ({ params }) => (
    <card title={`📊 ${params.topic}`}>
      <text>Click a button (or reply with its number):</text>
      <button label="👍 Yes" onClick={(m) => `${m.$sender.name} voted Yes`} />
      <button label="🤔 Wait" onClick={(m) => `${m.$sender.name} voted Wait`} />
    </card>
  ),
});
```

**Auto-discovered convention folders**: no manual wiring, hot-reloaded on save.

```text
my-bot/
├── plugin.ts                 # Root plugin entry: definePlugin()
├── commands/poll/index.tsx   # /poll command (auto-discovered)
├── middlewares/…             # runs on every message
├── tools/weather/index.ts    # tools the AI can call (optional)
└── zhin.config.yml           # configVersion: 2 (plugins & platforms)
```

</template>
<template #right>

**Up and running in 3 steps** (no platform accounts or API keys):

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

1. **Instant local Sandbox**: Open `http://127.0.0.1:8068/sandbox` and send `/hello`
2. **Remote Console**: Or open [console.zhin.dev](https://console.zhin.dev) with `http://127.0.0.1:8068` and `HTTP_TOKEN` from `.env`
3. **Hot-reload on save**: Edit any file under `commands/` and test immediately without restarting

**Where to go next**

- New to Zhin terms? → [Core concepts at a glance](/en/getting-started/concepts)
- Add commands, JSX cards, and AI tools → [Quick Start (with 1→2 examples)](/en/getting-started/)
- Extract a reusable sub-plugin package → [Write your first plugin](/en/getting-started/first-plugin)
- Connect Discord / Telegram / QQ / Lark → [Platform adapters](/en/adapters/)
- Add LLMs and tools → [AI overview](/en/ai/)
- Non-coder operator or group admin? → [Operator guide](/en/customer/)

</template>
</ZhinDuo>
