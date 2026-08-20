# IM Bot Path (No AI, ~1 Hour)

Goal: a chatbot that responds to commands and sends notifications. No AI concepts involved.

Want to first confirm "does the framework even run"? The [single-file-bot](../examples/index.md#single-file-bot-one-botts-is-a-bot) in the repo can reply to `/hello` in Console Sandbox with just one `bot.ts`.

## 1. Create a Project (2 minutes)

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` takes the IM-only golden path: Sandbox adapter (local debugging) + Remote Console, **no cloud keys needed**.
After seeing the startup logs, open [console.zhin.dev](https://console.zhin.dev),
set Host to `http://127.0.0.1:8086`, and the token is in `.env` under `HTTP_TOKEN`. Send **`/hello`** in Sandbox -- you should get a reply.

## 2. Write Your First Command (5 minutes)

The project already has a `hello` command. Write another one just like it -- create `roll.ts` in `commands/`:

```ts
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: 'Roll a die',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
})
```

Save and it hot-reloads. Send `roll` in Console's Sandbox and you will get a response.

**There is only one rule**: the file path under `commands/` is the command name (`commands/gh/issue.ts` -> command `gh issue`).

## 3. Scheduled Notifications (10 minutes)

Need "send a message to a group every day at 9am"? Use the schedule host -- in `plugin.ts`'s `setup()`:

```ts
import { definePlugin, scheduleHostToken } from 'zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-bot',
  setup(ctx) {
    if (ctx.resources.has(scheduleHostToken)) {
      const schedule = ctx.resources.use(scheduleHostToken)
      schedule.register({
        id: 'my-bot/morning',
        cron: '0 0 9 * * *',
        description: 'Morning greeting',
        async execute() { /* Send message via outbound host */ },
      })
    }
  },
})
```

## 4. Connect a Real Platform (20 minutes)

```bash
npx zhin setup    # Interactive wizard: choose platform -> fill in credentials (sensitive info auto-written to .env)
```

The wizard supports all 20 platforms (QQ Official / icqq / WeChat / Discord / Slack / Telegram...),
and QQ Official and WeChat iLink even support **QR code binding** -- no need to manually find tokens.

The generated config looks like this (credentials are placeholders; real values go in `.env`):

```yaml
plugins:
  qq:
    mode: websocket
    endpoints:
      - name: my-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
```

Restart and you are online. **One bot with multiple accounts?** Just add another item to the `endpoints` array.

## 5. What You Now Know

- Commands = files under `commands/`
- Config = `zhin.config.yml` (platforms) + `.env` (credentials)
- Management = Remote Console (send messages / change config / view logs / manage scheduled tasks)

## Next Steps

- Want AI chat -> [AI Agent Path](./ai-agent.md)
- Want to manage multiple accounts/platforms -> [Console Management Path](./console.md)
- Want to write complex plugins -> [Plugin Development](../authoring/define-plugin.md)
