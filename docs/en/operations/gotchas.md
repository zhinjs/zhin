---
title: "Gotchas and Counter-intuitive Behavior"
description: "Rules deployers of Zhin keep running into: configuration seeds, hot reload and re-login, MCP binding, fallback models, images in the Sandbox, memory and dependencies"
---

# Gotchas and counter-intuitive behavior

Rules deployers keep running into that are not failures. Each entry was checked against the current version; problems that have been fixed are not listed. For deployment steps see [Production deployment and operations](./production.md); for concrete failures see the [Troubleshooting center](../troubleshooting/index.md).

## Editing `endpoints` in the yml does not change the accounts {#endpoints-seed}

**Symptom**: you add, remove or change `endpoints` in an adapter block of `zhin.config.yml`; after a restart the new account does not run and the removed one still logs in.

**Why**: `endpoints` is only a **first-start seed**. While the project database has no account records for that adapter, startup creates accounts from the yml; afterwards the saved accounts in the database win, and adding, editing or toggling accounts in the Console changes the database. Later yml edits do not apply on their own.

**What to do**: manage accounts in the Console connections page. When the two differ, the startup log writes an `endpoint_config_drift` warning and the Console attention inbox lists the difference; each account can be imported from the configuration or written back to it on its account page. See [Configuration file accounts and saved accounts](../configuration/index.md#endpoints-drift).

## `--watch` in production does not save the re-login after an upgrade {#watch-relogin}

**Symptom**: you added `--watch` to the production instance to avoid re-logins, yet after upgrading a plugin or editing code the accounts disconnect and log in again (ICQQ accounts may need to pass verification again).

**Why**: hot reload swaps code in place only within a narrow range:

- only a single capability file in a convention directory (`commands/`, `tools/`, …) of a locally mounted plugin (a `./` reference in the main configuration) reloads by capability, without touching adapters;
- editing a plugin entry or a `src/` module shared by several modules rebuilds the whole plugin or even the whole instance; when an adapter plugin is rebuilt, its accounts log in again;
- a change to a runtime field of `package.json` (dependencies, `exports`, the `zhin` manifest; not `scripts` or `description`), a lockfile (`pnpm-lock.yaml`, …) or `.env` restarts the instance and every account logs in again;
- packages resolved from `node_modules` (plugins installed with `pnpm add` / `pnpm update`) are not watched at all.

So the most common production change, upgrading a package, always restarts the instance. `--watch` does not avoid that re-login, and it makes any accidental edit trigger a reload.

**What to do**: keep `--no-watch` in production (the scaffold's `pnpm start`), schedule upgrades for quiet hours and check the account states afterwards. Enabling or disabling a plugin needs no restart: through the gateway it applies in the running instance and adapters do not log in again. For what hot reload covers see the [Local development guide](../authoring/local-dev.md); for enabling and disabling plugins see the [CLI reference](../cli/index.md).

## `/pub/ready` returns 200 while an account is not online yet {#ready-not-online}

**Symptom**: the instance reports ready and the health check passes, but an account is still logging in or waiting for a QR scan or slider.

**Why**: account logins do not block instance readiness. Each account gets about 3 seconds; accounts that have not finished continue in the background. `gateway.readyTimeout` only bounds instance readiness, not account logins, so an account waiting on a slider does not hold the whole instance before ready.

**What to do**: when an account must be online for the instance to count as ready, list it in `http.readiness.endpoints`; complete the verification in the Console login tasks. See [Network and authentication](./production.md#_2-network-and-authentication).

## An MCP server shows "connected" but the Agent cannot use its tools {#mcp-unbound}

**Symptom**: a server in `ai.mcpServers` connects, yet in chat the Agent says it has no such tool.

**Why**: `ai.mcpServers` only connects. An Agent gets a server's tools only when `ai.agents.<name>.mcpServers` names the server. IM messages always use `ai.agents.zhin.mcpServers`; a server bound only to another Agent is not available in chat.

**What to do**: list the server under `ai.agents.zhin.mcpServers`. `zhin status` marks such a server as connected but usable by no Agent, and `zhin doctor` and the Console attention inbox list it (`mcp.unbound`). See [ai.mcpServers](../ai/index.md#ai-mcpservers).

## A fallback model is configured but the primary's error does not switch {#fallback-not-switching}

**Symptom**: a purpose has `fallbacks`, yet when the primary model fails the turn fails without trying the fallback.

**Why**: only errors another account can fix switch:

| Switches | Does not switch |
| --- | --- |
| Quota used up, out of credit | Rate limit (429) |
| Key rejected (401, `UNAUTHENTICATED`, `API_KEY_INVALID` and similar) | A plain 403 (a gateway refusing by content or region) |
| The same model timing out twice in a row within one request | A one-off timeout (retried on the same model) |
| Network errors and 5xx once the same-model retries (`providerResilience`) are used up | Rejected requests (400 and similar), content blocks, context overflow |

A request that already streamed text to the user never switches, and a fallback that cannot serve the request (no image support for the conversation's images, the context does not fit, it cannot continue the open tool call) is passed over.

**What to do**: look at the turn with `zhin trace`: a switch is recorded as `model_fallbacks`, a failure that did not switch as `model_fallback_skips` with the reason (`no_fallbacks`, `not_switching`, `exhausted`, `streamed`, `retry_forbidden`). Saving a purpose in the Console or importing `ai.plan.yml` again replaces the whole fallback chain, so include `fallbacks` when you write it. See [Fallback models](../ai/model-policy.md#fallback-models).

## The Agent cannot see an image uploaded in the Sandbox {#sandbox-image}

**Symptom**: you drag or paste an image into the Console Sandbox and send it; the Agent replies that it sees no image.

**Why**: an uploaded file is inserted into the message as a signed link, but plugins and the Agent cannot yet read uploaded files in process, and the Agent's inbound media only fetch HTTPS and refuse private addresses, so the Sandbox's own hosted files are out of reach.

**What to do**: to test image understanding, use a publicly reachable HTTPS image address: insert an image URL in the Sandbox, or write `[image:https://…]` in the text. See the [Sandbox adapter](../adapters/sandbox.md).

## An older project's `BOT.md` makes the Agent call a `cron_add` tool that does not exist {#bot-md-cron-add}

**Symptom**: asked to set a reminder, the Bot says it will use `cron_add`, or only writes the reminder into a memory file, and nothing is sent when it is due.

**Why**: the `BOT.md` / `AGENTS.md` that older scaffolds and `zhin migrate` generated say "Use `cron_add` for scheduled reminders"; that tool never existed. Newly generated files are corrected, but files in existing projects are not rewritten.

**What to do**: open the project's `BOT.md` (or `AGENTS.md`) and change its "Reminders" section: a fixed reminder message (once or at a fixed interval) uses `reminder_create` from the reminder skill (the reminder plugin must be installed and the skill activated first; the tool is not listed before that); a job where the AI produces content or calls tools when due, or that follows a calendar rule such as workdays or lunar dates, uses `schedule_add`; change an existing job with `schedule_update` instead of deleting and recreating it; never just write reminders to memory. The built-in `schedule_add` tool description states the same rules.

## A single `.tsx` file in the project costs extra memory {#tsx-memory}

**Symptom**: the project has only one `.tsx` command or component, yet the instance's resident memory is clearly higher than with `.ts` files only.

**Why**: Node loads `.ts` natively but not `.tsx`. The first time the instance meets a `.tsx` entry it enables an isolated TSX loader, and that loader, with the esbuild child process it starts, stays resident until the instance exits. One `.tsx` file is enough; the number of files does not matter.

**What to do**: on memory-constrained deployments, rewrite those entries as `.ts` files without JSX syntax so the loader is never enabled; when you need JSX, accept this resident cost. For how entries are loaded see [zhin runtime start](../cli/runtime.md).

## `zhin doctor` reports duplicate Zhin packages that upgrading does not remove {#retired-package}

**Symptom**: the "single instance of Zhin packages" check reports two copies of an `@zhin.js/*` package, and they remain after upgrading as suggested or running `pnpm dedupe`.

**Why**: the extra copy is often pulled in by an old package the project still depends on directly that is no longer published because it was merged into another package, for example `@zhin.js/config-yaml` (`YamlConfigDocument` now lives in `@zhin.js/runtime`). The old package gets no new versions, so the old `@zhin.js/runtime` and friends it depends on stay; `doctor` does not recognize such packages yet.

**What to do**: read the "required by" part after each copy in the `doctor` output. When it points at such a package, import from the replacement instead (for example `import { YamlConfigDocument } from '@zhin.js/runtime'`), remove the old package from `package.json`, reinstall and run `zhin doctor` again. No `pnpm.overrides` are needed for this. See the [CLI reference](../cli/index.md).
