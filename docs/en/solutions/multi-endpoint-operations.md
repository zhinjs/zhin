---
title: "Run one product through multiple accounts"
description: "Multiple platforms, several accounts on one platform, or separate test and production accounts: write business code once, connect and diagnose each account independently"
---

# Run one product through multiple accounts

For teams that need several platforms at once, several accounts on one platform, or separate test and production accounts. The goal: **write business code once**, while each account connects on its own and can be diagnosed on its own.

## Two terms first

- **Adapter**: the plugin that connects one platform, such as `icqq` or `slack`.
- **Endpoint**: one account or connection the bot is signed in to on a platform. One adapter can have several Endpoints.

Commands, components, and middleware belong to your plugin and are shared by every Endpoint. They aren't copied per account and don't call private platform SDKs.

## Steps

1. Check commands and replies in Sandbox.
2. Run `npx zhin setup --adapters` and install an adapter for each platform.
3. Add one entry per account under the adapter's `endpoints`; keep account secrets in environment variables.
4. After startup, send a test message from each Endpoint in Console's **Chat accounts**.
5. Check which operations (`operations`) each Endpoint supports in **Runtime Capabilities**. Connection modes of the same adapter can differ, so don't assume they match.
6. When something fails, filter **Logs** by level and Endpoint, and check Host and push health on the **Dashboard**.

For a config example, see [Multi-platform community bot](../showcase/community-bot.md#key-configuration-sanitized).

## Acceptance checklist

- Stopping any one Endpoint doesn't affect the other accounts.
- The same command gives the same business result in Sandbox and on real platforms.
- When a platform lacks recall, reactions, or similar operations, the UI hides or degrades them instead of calling a private SDK.
- The production HTTP Host uses a token; platform secrets never appear in the repository or the Console Demo.

## Next steps

- [Platform adapters](../adapters/): choose how to connect based on your deployment
- [Console path](../paths/console.md): manage several accounts in the browser
