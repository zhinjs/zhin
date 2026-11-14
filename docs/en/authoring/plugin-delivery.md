---
title: "Complete Plugin Delivery"
description: "Turn a working plugin into one that is configurable, hot-reloadable, tested and publishable to npm — design, implementation, local acceptance, tests and the release checklist"
---

# Complete plugin delivery

This page is for authors who have a first command working and now want to **hand the plugin to other people**. The goal is more than "the code runs": others can install and configure it, failures behave predictably, it's observable in Console, and it can be published to npm.

Work through the six steps below; each ends with questions you can check yourself against.

## 1. Write down what the plugin does

Before coding, list what users send, what the plugin returns, its side effects (database writes, messages, external APIs) and how you'll verify it. Then pick **one** style per capability:

| Need | Where it goes |
| --- | --- |
| Commands users type | `commands/*/index.ts` |
| Handling every message or platform event | `middlewares/*/index.ts` / `handlers/*/index.ts` |
| Cards and other rich messages | `components/*/index.tsx` |
| Actions and background knowledge for the AI | `tools/`, `prompt-sections/`, `skills/` |
| Database, schedules, proactive messages | `setup` in `plugin.ts`, via framework resources (Host tokens) |

One capability goes in a convention directory; shared resources or lifecycle go in `plugin.ts`; write a Feature only when defining a new kind of capability for the whole ecosystem.

## 2. Declare the package structure

- `package.json#zhin` declares the plugin package's own entry (`entry`) and the Features it uses (`features`); plugin instances (adapters, child plugins, services) are mounted in the host project's `zhin.config.yml` under `plugins:`.
- `zhin.config.yml` declares mounted plugin instances and config **values** — it doesn't install packages or enable Features.
- Plugins published to npm must use a JavaScript entry (`./plugin.js`); local projects can use `./plugin.ts` directly. See [definePlugin · Development entry vs. npm entry](./define-plugin.md#development-entry-vs-npm-entry).
- Declare optional capabilities (database, HTML rendering…) as optional peers, check them with `context.resources.has(token)` in `setup` (or `context.has(token)` in commands and tools), and degrade explicitly when missing.

## 3. Design the config

`definePlugin({ config: Schema.object(...) })` declares defaults, types, constraints and Console form hints in one place, with types inferred via `Schema.Output`. A root `schema.json` works too (if you also include an equivalent `schema.json` with identical structure, the runtime verifies their equivalence; `isolated` plugins must use `schema.json`). See [definePlugin · Read config](./define-plugin.md#read-config).

- Your bot itself reads the `plugin:` section; child plugins read `<instanceKey>`.
- Reference secrets with `${VAR}`; never put them in Schema defaults or example repos.

Check: after changing a setting, does the plugin need to reload? If the new config is invalid, does the old one stay in effect? How do you confirm in Console that the new value is live?

## 4. Implement capabilities and manage lifecycle

- Commands answer explicit user calls; middleware processes inbound messages in order; components produce rich messages that render on every platform.
- Tools declare actions the AI can take; Prompt Sections only add context and **cannot** grant tool or data permissions.
- Connections, timers and cleanup functions returned by framework resources go into `lifecycle` (`context.lifecycle.add(...)`) and are released automatically on hot reload.
- Resources that must connect successfully before the switch to a new version is allowed are registered with `handoff`. A new version failing to prepare must never affect the old version still serving.

See [definePlugin · Release resources on hot reload](./define-plugin.md#release-resources-on-hot-reload).

## 5. Local acceptance

1. In the Sandbox, exercise the simplest path of each command, component and AI feature.
2. In Console's Runtime Capabilities, check each capability's owning plugin, source, order and current version.
3. Edit one capability file and confirm only it reloads; break the config once on purpose and confirm the old version keeps serving.
4. For tools with side effects, verify approval, cancellation and the failure outcome.
5. Restart the bot and confirm the database, conversations and schedules recover as intended.

## 6. Test and publish

At minimum a plugin needs: unit tests for pure functions, a "capabilities are discovered" test, one full runtime integration test, and one failure-path test. Platform adapters should also use the adapter harness to verify connection lifecycle and message conversion. To avoid hand-assembled contexts and `as never`, use the fake runtime in [Testing Plugins](./testing.md).

```bash
pnpm build
pnpm check:plugin
pnpm check:plugin-runtime-api
pnpm check:plugin-capability-publish
```

Before publishing, check `files`, the ESM entry, peer dependencies, the generated JavaScript in convention directories, and the changeset. `npx @zhin.js/cli plugin check` checks the entry, `files` and the packed layout for you (see the [CLI reference](../cli/index.md#plugin-check-check-a-plugin-before-publishing)). **Install the packed tarball** into a fresh project and run the full Sandbox flow again — don't test only the workspace source.

A standalone plugin from `zhin new --standalone` publishes from its own directory:

```bash
npx @zhin.js/cli plugin check    # check the entry, files, convention directories and the packed result
npx @zhin.js/cli pub --dry-run   # runs plugin check first, then builds and previews the tarball, without publishing
npx @zhin.js/cli pub             # publish after confirming; add --yes in CI and other non-interactive shells
```

Prefer `npx @zhin.js/cli`: without `@zhin.js/cli` installed in the plugin directory, `npx zhin` downloads the npm package named `zhin`. Since `zhin@4` that is an alias of `@zhin.js/cli`, but a `zhin@3.x` left in the npx cache or a lockfile is the old, unmaintained framework package. Inside a bot project, where `@zhin.js/cli` is installed, `npx zhin` uses it directly.

### Marketplace metadata {#marketplace-metadata}

The plugin market (the docs site `plugins.json`, the Console plugin market, `zhin search` / `zhin info`) only reads the `package.json` published to npm; it never runs plugin code. These fields decide how your plugin appears there:

| Field | Shape | Use in the market |
| --- | --- | --- |
| `zhin.metadata.displayName` / `displayNameI18n` | As for the Console; `{ "zh-CN": "...", "en": "..." }` | Card title, chosen by interface locale, falling back from the current locale → `en` → `zh-CN` → `displayName` |
| `zhin.metadata.descriptionI18n` | `{ "zh-CN": "...", "en": "..." }`, non-empty strings | Card description, falling back to the top-level `description`; searches match both languages |
| `zhin.metadata.category` | One value from the table below | Category filter. Inferred from the package name and keywords when absent |
| `author` | `{ "name": "...", "url": "..." }` | The author. The market shows `author`, else `maintainers`, and **never** the publishing account (with CI trusted publishing that is "GitHub Actions") |
| `keywords` | 3–6 words describing what it does | Tags and search. `zhin`, `zhin.js`, `zhinjs`, `zhin-plugin`, `bot`, `chatbot` and `plugin` are generic: the market neither shows nor searches them. Keep `zhin.js` for npm keyword search |

`descriptionI18n` and `category` belong in `package.json#zhin.metadata` only; `definePlugin()` does not take them. The manifest is validated strictly on load: locale keys are `zh-CN` / `en` only, and `category` must be one of:

| `category` | Meaning | Examples |
| --- | --- | --- |
| `adapter` | Platform adapters | Telegram, OneBot 11, Lark |
| `ai` | AI capabilities and inference services | TypeSafe decision provider |
| `admin` | Administration | Process monitor |
| `community` | Group community management | Group suite |
| `entertainment` | Entertainment | Music, repeater, Book of Answers |
| `game` | Games | Blackjack, idiom chain |
| `information` | News, feeds and subscriptions | RSS, earthquake alerts, Bilibili subscriptions |
| `moderation` | Content safety | Content moderation |
| `service` | Infrastructure for other capabilities | Activity feedback |
| `utility` | Utilities | QR code, short URL, ledger, reminders |

```json
{
  "name": "zhin.js-plugin-weather",
  "description": "Weather forecasts and alerts for any city",
  "keywords": ["zhin.js", "weather", "forecast", "天气"],
  "author": { "name": "your-github-name", "url": "https://github.com/your-github-name/zhin.js-plugin-weather" },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "metadata": {
      "displayName": "Weather",
      "displayNameI18n": { "zh-CN": "天气", "en": "Weather" },
      "descriptionI18n": { "zh-CN": "查询城市天气预报与预警", "en": "Weather forecasts and alerts for any city" },
      "category": "information"
    }
  }
}
```

Official plugins in this repository are also checked by `pnpm check:plugin`: `descriptionI18n` in both languages, a valid `category`, an `author` in `{ name, url }` form without an email, and 3–6 non-generic keywords.

## Done when

- A new user can install, configure minimally and get a first reply by following the README.
- Config errors, missing dependencies and failed hot reloads all behave and report clearly.
- Console shows runtime state without leaking Prompt text or secrets.
- Package docs, public API, changeset and the actual published tarball agree.

## Next steps

- [definePlugin](./define-plugin.md): everything the entry can do.
- [Convention directories](./conventions.md): where each capability goes.
- [Console pages](./console-pages.md): add a management page to your plugin.
- [Local development guide](./local-dev.md): try local plugins and framework in an external project before publishing.
