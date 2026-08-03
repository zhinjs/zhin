# Console Management Path (~1 Hour)

Goal: manage your bot in a browser -- send messages, change config, view logs, manage multiple accounts.
Console is a standalone site at [console.zhin.dev](https://console.zhin.dev);
your bot (Host) only exposes an API and does not serve any pages.

## 1. Connect Your Bot (3 minutes)

After your bot starts (default `http://127.0.0.1:8086`):

1. Open [console.zhin.dev](https://console.zhin.dev)
2. Set Host to `http://127.0.0.1:8086`
3. Set Token to the `HTTP_TOKEN` from your `.env`

Three steps, that is it. No account system. The token is your authority -- do not leak it.

## 2. Dashboard Quick Tour (10 minutes)

| Page | What You Can Do |
|------|-----------------|
| Overview | Plugin count / endpoint online count / uptime / memory |
| Plugins | Capability card for each plugin (commands/tools/pages/adapters); click in to edit config |
| Endpoints | Connection status for each account; click in to see friends/groups/send and receive messages |
| Config | Edit any plugin config via form (hot-reload), or directly edit the full YAML |
| Logs | Runtime logs stored in SystemLog (database), filterable by level |
| Database | Browse/edit the bot's SQLite tables |
| Scheduled Tasks | Start/stop/create/delete cron tasks |

## 3. Multi-Account Management (15 minutes)

One adapter plugin can host multiple accounts (endpoints) -- five QQ alt accounts, QQ Official main bot + sandbox bot.
On the "Plugins" page, they appear as **one card with a row of endpoints beneath it**, each showing its online status.

Two ways to add accounts:

- **Config file**: Add an item to the `plugins.<adapter>.endpoints` array, then restart
- **Chat command** (some platforms): Send `qq.endpoint add` in QQ Official chat,
  scan the QR code on your phone to bind (credentials are auto-written to `.env`, config auto-appended, restart to take effect)

## 4. Send & Receive Messages Live (10 minutes)

Click into any endpoint on the "Endpoints" page:

- Friends / groups list (when the platform supports it)
- Select a conversation and send a message (uses the exact same outbound chain as bot replies)
- Inbound messages push in real-time (SSE), no refresh needed

## 5. Remote / Production Setup (10 minutes)

- **CORS**: Add your Console origin to `http.corsOrigins`
- **Demo read-only mode**: Use a demo token for public demos (read-only RPC, all write operations return 403)
- **Reverse proxy**: Console and API can share a domain -- reverse-proxy `/api` and `/entries` to the bot's port 8086

## What You Now Know

- Console = a pure frontend site + your bot provides the API; token is authority
- Multi-account = one plugin card with multiple endpoints underneath
- Day-to-day operations (logs/config/scheduled tasks/messaging) require no SSH and no code changes

## Next Steps

- Write your own Console pages -> Plugin `pages/` directory (refer to the sandbox adapter)
- Real multi-platform deployment reference -> [Multi-Platform Community Bot Showcase](../showcase/community-bot.md)
