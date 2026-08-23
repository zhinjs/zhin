---
title: Multi-Endpoint Operations
---

# Operate one product through multiple accounts

Use this when you need multiple platforms, multiple accounts on one platform, or test and production isolation. The result is one business capability set, independent connections, and Endpoint-level diagnosis.

## Design boundary

An Adapter defines a platform protocol. An Endpoint is one account or connection. Commands, components, and middleware belong to the plugin generation; they are not copied per account and do not read private platform SDKs.

## Implementation

1. Prove commands and message output in Sandbox.
2. Run `npx zhin setup --adapters` and install each real adapter.
3. Create separate Endpoint configuration for each account. Keep credentials in environment variables.
4. After startup, send a test message through every Endpoint in Console Conversations and Channels.
5. Check each Endpoint's `operations` under Runtime Capabilities. Connection modes of one adapter may differ.
6. Diagnose with scoped Logs and verify Host and push health on the Dashboard.

## Acceptance

- Stopping one Endpoint does not affect other accounts.
- One command produces equivalent business results in Sandbox and on real platforms.
- Unsupported recall or reaction operations degrade through capability checks.
- Production HTTP uses a token and credentials never enter the repository or Console Demo.

Continue with [Adapter selection](/en/adapters/) and the [Console Admin path](/en/paths/console).
