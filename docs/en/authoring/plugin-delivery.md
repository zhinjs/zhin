---
title: Complete Plugin Delivery
---

# From business capability to a publishable plugin

Use this after the first command, when the plugin must become configurable, hot-reloadable, testable, and publishable. Success means installation, runtime, governance, observability, and release form one loop.

## 1. Write the delivery contract

List inputs, outputs, side effects, and acceptance before implementation. Choose one authoring surface per capability: convention files for one capability, `plugin.ts` for shared lifecycle, and a Feature only for a new ecosystem contract.

| Need | Surface |
| --- | --- |
| Explicit text command | `commands/*.ts` |
| Inbound orchestration | `middlewares/*.ts` / `handlers/*.ts` |
| Rich message output | `components/*.tsx` |
| Agent behavior | `agent/tools`, `agent/prompt-sections`, `agent/skills` |
| Database, schedules, proactive delivery | `plugin.ts` + Host tokens |

## 2. Establish package and runtime topology

`package.json#zhin` declares the plugin entry, Feature dependencies, and child instances. `zhin.config.yml` supplies values; it does not install packages or mount Features.

Published packages must use a JavaScript entry. A source Root Plugin may use `./plugin.ts`. Keep optional capabilities as optional peers and degrade explicitly with `resources.has(token)`.

## 3. Design configuration

Declare defaults, types, and constraints in `schema.json`. Root config reads `plugin:`, while child instances read `plugins.<instanceKey>`. Reference secrets with `${VAR}`; never place them in defaults or examples.

For every change, answer whether it needs a new generation, whether the old generation keeps serving on failure, and how Console proves publication.

## 4. Implement capability and lifecycle

Commands own explicit calls, middleware owns inbound order, and components own portable rich messages. Tools expose actions to the model. Prompt Sections add context but never grant tool or data authority.

Put cleanup from connections, timers, and Host registrations into `lifecycle`. Use `handoff` for resources that must prove readiness before publication. A failed candidate must not alter the serving generation.

## 5. Accept locally

1. Prove the minimal command, component, and Agent path in Sandbox.
2. Inspect owner, source, order, and current generation in Runtime Capabilities.
3. Edit one capability file to prove file-level HMR; introduce invalid config and prove the old generation stays live.
4. Verify approval, cancellation, and failure terminal states for side-effecting Tools.
5. Restart Runtime and verify database, session, and schedule recovery contracts.

## 6. Test and publish

Cover pure functions, capability discovery, one Runtime integration, and one failure path. Platform plugins should also use the adapter harness for Endpoint lifecycle and message normalization.

```bash
pnpm typecheck
pnpm check:plugin
pnpm check:plugin-runtime-api
pnpm check:plugin-agent-publish
```

Before release, inspect `files`, ESM entry points, peer dependencies, generated convention JavaScript, and the changeset. Install the packed artifact and rerun the Sandbox golden path; workspace source alone is insufficient.

## Done when

- A new user can install, minimally configure, and send the first message from the README.
- Invalid config, missing dependencies, and failed reloads have explicit behavior.
- Console exposes runtime facts without leaking Prompt or secret content.
- Package docs, public API, changeset, and the actual tarball agree.

Continue with [`definePlugin` overview](./define-plugin), [convention directories](./conventions), and [Console pages](./console-pages).
