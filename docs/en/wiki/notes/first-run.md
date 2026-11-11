---
title: How do I know the first Bot works?
---

# How do I know the first Bot really works?

**A running process is only the beginning.** Send `/hello` in a Remote Console Sandbox conversation and receive a reply. That checks the HTTP Host, authentication, Endpoint, command discovery, and outbound path together.

This check is for a newly created IM project. It needs no platform account or model key. Scaffolded TypeScript projects require Node.js `>=22.19.0` and pnpm 9 or newer.

## Start from an empty directory

```bash
npm create zhin-app my-bot -- -y --adapter sandbox
cd my-bot
pnpm dev
```

`--adapter sandbox` installs Sandbox at creation time; without it the project has no adapter and you pick Sandbox in the Console onboarding's adapter step. Creation ends with a Console link (`?apiBaseUrl=` points at the Host, the bootstrap token sits after `#token=`). New projects currently default to port `8068`, but use the terminal output or `zhin.config.yml` for your project.

Open the link, keep the default database, create the owner account, then open a Sandbox conversation and send `/hello`. Lost the link? At [console.zhin.dev](https://console.zhin.dev), enter the API Base and the `HTTP_TOKEN` from the project's `.env`.

If Console cannot connect, check the API Base and Token, then run `npx zhin doctor`. If it connects but the Bot does not reply, check command discovery, the Sandbox Endpoint state, and terminal errors.

## What to change next

Edit the reply in `commands/hello/index.ts`, save, and send `/hello` again to check hot reload. Add a real [adapter](/en/adapters/) or [AI](/en/ai/) only when you need it.

The [Getting Started guide](/en/getting-started/) has the complete first-run steps and version requirements. [Configuration](/en/configuration/) explains which file owns each kind of setting.
