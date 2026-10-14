---
layout: home
---

<ZhinHero tagline="Write a chat bot once in TypeScript and run it on QQ, WeChat, Discord, Telegram and 20+ other platforms. A small IM framework by default — add AI when you need it." />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot -y<br>
<b>$</b> cd my-bot && pnpm dev<br>
<span>✔ Bot started — no platform account or model key required</span>
</ZhinTerminal>

<ZhinRolePaths heading="What do you want to do?" intro="You don't need the full architecture first. Pick a goal — each path fits in one sitting." :items="[
  { eyebrow: 'LEARN', title: 'Understand what it is', description: 'One page on what Zhin does and which parts make up a bot.', href: '/en/getting-started/introduction', action: '5-minute overview' },
  { eyebrow: 'RUN', title: 'Run your first bot', description: 'No platform account or model key — get a reply in the browser Sandbox.', href: '/en/getting-started/', action: 'Start the quick start' },
  { eyebrow: 'BUILD', title: 'Write your own features', description: 'Commands, keyword replies, schedules, AI tools — drop a file in a folder and it works.', href: '/en/getting-started/first-plugin', action: 'Write a first plugin' },
  { eyebrow: 'SHIP', title: 'Connect platforms and go live', description: 'Pick adapters for QQ / WeChat / Discord and more, then deploy, monitor and upgrade.', href: '/en/adapters/', action: 'Choose a platform' },
]" />

<ZhinFeatureGrid heading="Why Zhin.js" :features="[
  { title: 'One codebase, 20+ platforms', desc: 'QQ, WeChat, WeCom, DingTalk, Lark, Discord, Telegram, Slack, KOOK, LINE… Your code sees one kind of message; adapters handle the platform differences.' },
  { title: 'A feature is a file', desc: '<code>commands/hello/index.ts</code> is the <code>/hello</code> command. Middleware, components, schedules and AI tools work the same way — no registration boilerplate.' },
  { title: 'No restarts while coding', desc: 'Save to hot-reload. In-flight messages finish on the old version, and if the new code throws, the old version keeps serving.' },
  { title: 'Develop with zero accounts', desc: 'The built-in Sandbox is a simulated chat window. Build and test everything without any platform account or model key.' },
  { title: 'Manage it in the browser', desc: 'Open <code>console.zhin.dev</code>, enter your address and token: send test messages, read logs, edit config, manage plugins. Nothing to deploy.' },
  { title: 'Opt-in AI', desc: 'The default install is an IM core under 10MB. Run <code>npx zhin setup --ai</code> to add models, tools, memory and MCP.' },
]" />

<ZhinDuo heading="What a bot looks like">
<template #left>

**Smallest form**: one `bot.ts` is the whole bot.

```ts
import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';

export default definePlugin({
  name: 'my-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: 'Say hello',
      execute: () => 'Hello from Zhin!',
    }));
  },
});
```

**As it grows**: one file per capability, auto-registered from convention folders.

```text
my-bot/
├── plugin.ts                 # entry: definePlugin()
├── commands/hello/index.ts   # the /hello command
├── middlewares/…             # keyword replies, filters
├── tools/…                   # tools the AI can call (optional)
└── zhin.config.yml           # port, platform credentials, models
```

</template>
<template #right>

**Running in 10 minutes** (no accounts or keys):

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

1. Open [console.zhin.dev](https://console.zhin.dev)
2. Enter the address printed in the terminal and `HTTP_TOKEN` from `.env`
3. Send `/hello` in the Sandbox

**Next**

- Confused by a term? → [Core concepts](/en/getting-started/concepts)
- Write your own command → [First plugin](/en/getting-started/first-plugin)
- Connect a real platform → [Adapters](/en/adapters/)
- Add AI → [AI overview](/en/ai/)

</template>
</ZhinDuo>
