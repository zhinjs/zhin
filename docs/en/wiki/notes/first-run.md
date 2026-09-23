---
title: How do I know the first Bot works?
---

# How do I know the first Bot really works?

**A running process is only the beginning.** Send `/hello` in a Remote Console Sandbox conversation and receive a reply. That checks the HTTP Host, authentication, Endpoint, command discovery, and outbound path together.

This check is for a newly created IM project. It needs no platform account or model key. Scaffolded TypeScript projects require Node.js `>=22.12.0` and pnpm 9 or newer.

## Start from an empty directory

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

The terminal prints the API Base. New projects currently default to port `8068`, but use the terminal output or `zhin.config.yml` for your project.

At [console.zhin.dev](https://console.zhin.dev), enter that API Base and the `HTTP_TOKEN` from the project's `.env`. Open a Sandbox conversation and send `/hello`.

If Console cannot connect, check the API Base and Token, then run `npx zhin doctor`. If it connects but the Bot does not reply, check command discovery, the Sandbox Endpoint state, and terminal errors.

## What to change next

Edit the reply in `commands/hello/index.ts`, save, and send `/hello` again to check hot reload. Add a real [adapter](/en/adapters/) or [AI](/en/ai/) only when you need it.

The [Getting Started guide](/en/getting-started/) has the complete first-run steps and version requirements. [Configuration](/en/configuration/) explains which file owns each kind of setting.
