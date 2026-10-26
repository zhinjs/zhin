---
title: "IM Bot path: ship a bot without AI"
description: "Start in Sandbox, add a command and a scheduled notification, then connect a real chat platform and check it in Console. About an hour, no model needed"
---

# IM Bot path: ship a bot without AI

This path builds a bot that receives a message, runs your logic, and replies or sends a notification on its own. It takes 45–60 minutes and needs no model or API key.

When you're done you'll have:

- a custom `/roll` command that updates without a restart when you save;
- a notification sent on a daily schedule;
- at least one real chat platform (QQ, Discord, Slack…) online.

## 1. Get it working in Sandbox

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

Sandbox is a built-in simulated chat window; it needs no platform account. Connect [Console](https://console.zhin.dev) with the API Base printed in the terminal and `HTTP_TOKEN` from `.env`, open **Bot → Try a chat** (Sandbox) in the sidebar, send `/hello`, and check that it replies.

## 2. Add a command

Create `commands/roll/index.ts`:

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Roll a six-sided die',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
});
```

Save, then send `/roll` in Sandbox. You see the dice roll without restarting.

The command name comes from the file path: `commands/roll/index.ts` is `/roll`, and `commands/gh/issue/index.ts` is `/gh issue`. For parameters and permissions, see [Commands](../authoring/commands.md).

## 3. Add a scheduled notification

The plugin entry below registers a job that runs at 9:00 every day. The scheduler only decides *when*; the message itself goes through the outbound service you get from `outboundHostToken`, so Sandbox and real platforms share one send path.

```ts
import {
  definePlugin,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';

interface Config {
  morningTarget?: {
    adapter: string;
    endpointKey: string;
    conversation: { kind: 'private' | 'group' | 'channel'; id: string };
  };
}

export default definePlugin<Config>({
  name: 'my-bot',
  setup(context) {
    const target = context.config.get().morningTarget;
    if (!target) return;
    if (!context.resources.has(outboundHostToken)) return;
    const outbound = context.resources.use(outboundHostToken);
    const schedule = context.resources.use(scheduleHostToken);

    context.lifecycle.add(schedule.register({
      id: 'my-bot/morning',
      cron: '0 0 9 * * *',
      description: 'Send a morning greeting',
      execute: async () => {
        await outbound.send({
          ...target,
          content: 'Good morning',
        });
      },
    }));
  },
});
```

The job is registered only after you set `morningTarget` in config:

- `endpointKey` is the full Endpoint identity shown in **Chat accounts** (an Endpoint is one account the bot is signed in to on a platform);
- `cron` has six fields: second, minute, hour, day, month, weekday;
- `context.lifecycle.add()` unregisters the old job on hot reload or when the plugin stops, so nothing is sent twice.

::: details Why check `resources.has(outboundHostToken)` first?
Host tokens such as `outboundHostToken` and `scheduleHostToken` are services the runtime provides to plugins. A plugin can only use one when the current runtime installed it; checking first lets the plugin skip quietly where outbound delivery is unavailable (some tests, for example) instead of throwing. See [Host capabilities](../authoring/host-tokens.md).
:::

## 4. Connect a real platform

```bash
npx zhin setup --adapters
pnpm install
pnpm dev
```

The wizard asks which platform to connect, then updates `package.json#zhin.plugins`, `zhin.config.yml`, and `.env` together. Account secrets go only into `.env`; the config file keeps `${VAR}` references.

The `/roll` command and the notification need no changes: commands don't depend on a specific platform, so moving from Sandbox to QQ, Discord, or Slack leaves your code as is. Per-platform setup is in [Platform adapters](../adapters/index.md).

## 5. Accept the result in Console

1. Confirm the Endpoint and send a message in **Chat accounts**.
2. In **Runtime Capabilities**, confirm `/roll` is loaded and is the version you last saved.
3. Check **Logs** for command or notification failures.
4. Restart the Host and repeat the real-platform test.

## Common pitfalls

- **Config in the wrong place**: `zhin.config.yml` holds values only; which plugins are installed lives in `package.json#zhin.plugins`.
- **Bypassing the send path**: send proactive messages through `outboundHostToken`; don't keep an adapter instance and call its send method yourself.
- **A missing cron field**: schedules need six fields with seconds first; a five-field expression such as `0 9 * * *` is rejected.

## Next steps

- [AI Agent path](./ai-agent.md): let the bot chat with a model and call tools
- [Console path](./console.md): manage several accounts and diagnose problems in the browser
- [Commands](../authoring/commands.md): add parameters, permissions, and subcommands
