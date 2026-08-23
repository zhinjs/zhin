# Deliver an IM Bot without AI

Goal: complete the loop from inbound message to business logic to reply or proactive notification. Allow 45–60 minutes; no model, Prompt, or Agent is involved.

## Done means

- `/roll` replies reliably in Sandbox.
- Saving code publishes a new generation.
- At least one real platform Endpoint is online.
- Proactive notifications use the Runtime outbound capability, not an Adapter singleton.

## 1. Start with a repeatable Sandbox

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

Connect Console with the API Base printed by the Host and `HTTP_TOKEN` from `.env`. Open Sandbox under **Conversations & Channels** and verify `/hello` first.

## 2. Add a command

Create `commands/roll.ts`:

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Roll a six-sided die',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
});
```

Save and send `/roll`. The file path supplies the route; `commands/gh/issue.ts` becomes `/gh issue`.

## 3. Add a proactive notification

The schedule decides when work runs. Delivery still goes through `outboundHostToken`, so Sandbox and real platforms share one outbound path.

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

Use the complete Endpoint identity shown in **Conversations & Channels** as `endpointKey`. `lifecycle.add()` unregisters the old job when its generation retires.

## 4. Connect a real platform

```bash
npx zhin setup --adapters
pnpm install
pnpm dev
```

The wizard updates `package.json#zhin.plugins`, `zhin.config.yml`, and `.env` together. Secrets go to `.env`; configuration keeps variable references.

One Adapter instance can own multiple Endpoints. Commands and components should not depend on the Adapter, so moving from Sandbox to QQ, Discord, or Slack does not rewrite business logic.

## 5. Accept the result in Console

1. Confirm the Endpoint and send a message in **Conversations & Channels**.
2. Confirm `/roll` belongs to the current generation in **Runtime Capabilities**.
3. Check **Logs** for command or notification failures.
4. Restart the Host and repeat the real-platform test.

## Boundaries to keep

- `zhin.config.yml` stores values; plugin topology belongs in `package.json#zhin`.
- Proactive delivery uses `outboundHostToken`, never a global Adapter instance.
- Schedules use six-field cron: second, minute, hour, day, month, weekday.
- A plugin can use only Host tokens installed for its Runtime.

## Next

- Add models and tools: [AI Agent path](./ai-agent.md)
- Operate accounts and runtime state: [Console path](./console.md)
- Learn command parameters and authority: [Commands](../authoring/commands.md)
