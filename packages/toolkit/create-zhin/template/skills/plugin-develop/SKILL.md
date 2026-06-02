---
name: plugin-develop
description: "Develop Zhin.js plugin features such as commands, tools, middleware-style guardrails, cron jobs, and console pages."
keywords:
  - plugin
  - command
  - tool
  - cron
  - console page
tags:
  - zhin
  - plugin
---

# Plugin Develop

Use this skill when implementing or extending a Zhin plugin.

## Workflow

1. Locate the plugin entry under `src/plugins/` or `plugins/<name>/src/`.
2. Choose the smallest runtime API that matches the feature: `addCommand`, `addTool`, `addCron`, `useContext`, or a console page entry.
3. Keep platform-specific behavior behind adapter checks or tool metadata.
4. Validate with `pnpm build`; use `pnpm dev` for manual Sandbox testing.

## Output

Implement the plugin change and report the commands or messages used to verify it.
