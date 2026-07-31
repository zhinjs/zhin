---
layout: home
---

<ZhinHero tagline="A multi-channel IM framework built for assistant bots. Plugins are Lego blocks, hot reload is the norm, and Console lives in your browser." />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot<br>
<b>$</b> cd my-bot && pnpm dev<br>
<span>✔ IM golden path started — no model key required</span>
</ZhinTerminal>

<ZhinFeatureGrid heading="Why Zhin.js" :features="[
  { title: 'Plugin-based Core', desc: 'A <code>package.json#zhin</code> manifest plus a <code>plugin.ts</code> is all you need. Commands, components, and adapters are discovered from convention directories. Edit a file, get instant hot reload.' },
  { title: 'Multi-platform, One Message Flow', desc: 'QQ, OneBot, Discord, Telegram, Slack, KOOK, DingTalk, Lark, WeCom, LINE… 20+ adapters mount on demand, all sharing the same send chain.' },
  { title: 'Zero-deploy Console', desc: 'Host exposes only API. Open your browser to manage plugins, view instances, browse logs, and edit config — the frontend does not need to run alongside the bot.' },
  { title: 'Opt-in AI', desc: 'Only the IM core ships by default. Install <code>@zhin.js/agent</code> when you need it — providers, MCP, sub-agents, and scheduled tasks unlock layer by layer.' },
  { title: 'Plugin as Application', desc: 'Drop a <code>zhin.config.yml</code> in a plugin directory and <code>zhin runtime start</code> runs it directly. No host project required.' },
  { title: 'Unidirectional Layers', desc: 'basic → kernel → ai → core → agent → zhin. Dependencies only flow downward. Each layer is usable standalone — kernel is a pure plugin engine, ai is a pure LLM engine.' },
]" />

<ZhinDuo heading="One file, one bot">
<template #left>

`bot.ts` — your entire bot can be just this one file.

```ts
import { defineCommand } from 'zhin.js/command';
import { definePlugin } from 'zhin.js/plugin-runtime';

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

</template>
<template #right>

Three steps to get running (no model key needed):

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

Open [console.zhin.dev](https://console.zhin.dev) →
Sandbox → `/hello`.

Want convention directories instead? Default-export the same
`defineCommand(...)` from `commands/hello.ts` — see [minimal-bot](/en/examples/#minimal-bot-stable-minimal-path).

</template>

Full single-file example: [single-file-bot](/en/examples/#single-file-bot-one-bots-is-a-bot).
Database, cron, proactive push, Agent? Check out [definePlugin overview](/en/authoring/define-plugin) for what `setup` can do.
</ZhinDuo>
