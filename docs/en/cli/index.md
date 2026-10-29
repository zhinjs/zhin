---
title: "CLI Reference"
description: "Every zhin subcommand: start and stop, the setup wizard, installing and publishing plugins, diagnostics, messaging a running bot, schedules and system services"
---

# CLI reference

Day to day, working with Zhin mostly means working with one command, `zhin`: start the bot, change config, install plugins, diagnose problems. It comes from `@zhin.js/cli` and is called in a project as `npx zhin …` or `pnpm exec zhin …`. Creating a new project uses a separate command, `npm create zhin-app`.

```bash
npx zhin --help        # list every command
```

::: tip Running outside a bot project
Inside a project that has `@zhin.js/cli` installed, `npx zhin` uses it directly. Outside one (for example creating a standalone plugin, or publishing from a plugin directory), npx downloads the npm package named `zhin`:

- Since `zhin@4.0`, `zhin` on npm is an alias of `@zhin.js/cli`: `npx zhin <command>` is the same as `npx @zhin.js/cli <command>`.
- `zhin@3.x` is the old, unmaintained framework package, not this CLI. If your npx cache still holds 3.x, or a project pins `zhin@^3`, you get that one instead, which shows up as missing commands or startup errors. Use `npx @zhin.js/cli` (reliable with every version), or `npx zhin@latest` to force the new one.
:::

## The commands you'll use most

| I want to… | Command |
| --- | --- |
| Start the bot (dev mode, hot reload on save) | `pnpm dev` (i.e. `zhin runtime start`) |
| Connect a platform, configure AI or a database | `npx zhin setup` (optionally `--adapters` / `--ai` / `--database`) |
| Diagnose environment or config problems | `npx zhin doctor` |
| Check the config file is valid | `npx zhin config check` |
| Install a community plugin | `npx zhin install <plugin>` |
| Find plugins and setup steps by purpose | `npx zhin use-cases` |
| Create a new, publishable plugin | `npx @zhin.js/cli new my-plugin --standalone` |
| Check a plugin before publishing | `npx @zhin.js/cli plugin check` |
| Add a local plugin to an existing bot project | `npx zhin new my-plugin` |
| Upgrade Zhin | `npx zhin migrate --dry-run`, then again without `--dry-run` |
| Install as a start-on-boot system service | `npx zhin service install` |

All commands, grouped by purpose, follow.

## Running

### runtime: Run and Manage Projects

```bash
zhin runtime start [--mode production] [--no-watch] [--daemon]
zhin runtime inspect
zhin runtime build
zhin runtime publish [--execute|--resume] [--tag latest]
zhin runtime migrate [extract|cutover|status] [--check|--write]
```

| Subcommand | Purpose |
| --- | --- |
| `start` | Start the bot, with dev hot reload, production and daemon modes; see [zhin runtime start](./runtime.md) |
| `inspect` | Print the project structure as JSON (plugin list, build plan) |
| `build` / `publish` | Build and publish according to the project structure. `publish` only prints the plan by default; `--execute` runs it, and `--resume` continues after an interruption |
| `migrate` | Generate and apply a project-structure migration plan: `--check` previews, `--write` writes atomically, `status` prints a readiness report |

Scaffolded projects already have two conventional scripts:

```json
{
  "scripts": {
    "dev": "zhin runtime start",
    "start": "zhin runtime start --mode production --no-watch"
  }
}
```

### stop: Stop the Bot

```bash
zhin stop
```

Stops the process started with `--daemon` in this project (reads `.zhin.pid`). With nothing running it just says so; it isn't an error.

### service: System Service

```bash
zhin service install [--user]
zhin service uninstall [--user]
zhin service status [--user]
```

Installs a start-on-boot / supervised service. `--user` uses user-level systemd on Linux; `status` works on Linux and macOS only.

## Configuration and diagnostics

### setup: Interactive Configuration Wizard

```bash
zhin setup                 # full wizard
zhin setup --database      # database only
zhin setup --adapters      # adapters only (add accounts)
zhin setup --ai            # AI only
zhin setup --decisions     # optional TypeSafe Jev decision service (needs existing AI config)
zhin setup --bootstrap     # bootstrap files only (SOUL.md / TOOLS.md / AGENTS.md)
zhin setup --global        # initialize a global instance in ~/.zhin
```

The wizard edits the matching parts of [`zhin.config.yml`](../configuration/index.md) and writes secrets to `.env`.

For network databases, the CLI checks the port range, writes connection fields as environment references and puts the real values in `.env`. Afterwards run `npx zhin config check` to catch missing database variables before startup; if the values only live in `.env.production`, use `npx zhin config check --environment production`.

### config: Read and Write Configuration Files

```bash
zhin config list
zhin config get <key>            # nested paths such as ai.enabled
zhin config set <key> <value>    # value accepts JSON
zhin config delete <key>
zhin config path                 # print the config file path
zhin config check [--fix] [--json] [--strict]
```

`config check` validates the config file, and `--fix` repairs fields that can be migrated safely. Missing database connection variables are always errors; other warnings become errors with `--strict`, which suits CI.

### doctor: Environment Diagnostics

```bash
zhin doctor [--fix] [--upgrade-l4]
```

Checks Node, ports, tokens, config and other environment issues; `--fix` repairs what it can; `--upgrade-l4` diagnoses what's needed to go from a minimal project to the full AI stack. When `--fix` adds dependencies it writes the real version ranges released alongside the CLI (e.g. `^1.1.11`), never `latest`; run `pnpm install` afterwards.

### dev: Develop Against a Local zhin Checkout or a Standalone Plugin

```bash
zhin dev link <zhin-path> [--project <dir>] [--no-install]
zhin dev unlink [--project <dir>] [--no-install] [--force]
zhin dev link <plugin-dir> [--project <dir>] [--as <instance>]
zhin dev unlink <instance> [--project <dir>]
```

When `<plugin-dir>/package.json` has a `zhin` field, connects the standalone plugin to the current bot: links it under `plugins/`, adds `./plugins/<instance>`, and makes the plugin's `@zhin.js/*` use the bot's copies, so edits hot-reload. See [hot-reload a standalone plugin](/en/authoring/local-dev#dev-link-plugin).

Given a zhin checkout, in an external plugin project it switches `zhin.js` / `@zhin.js/*` to a local checkout as a whole (packs the full dependency closure and writes `pnpm.overrides`, so each package has exactly one instance); `unlink` restores the original files. The "Zhin 包单实例" check in `doctor` detects duplicate instances and suggests this command. See the [local development guide](/en/authoring/local-dev).

### onboard: Project Onboarding

```bash
zhin onboard [--quick] [--flow quickstart|full]
```

Reuses existing config, environment variables and data in a project, letting you keep or reconfigure them. `--quick` (`-q`) only shows the quick-start hints without the wizard; `--flow` defaults to `full`, and `quickstart` asks fewer questions.

### migrate: Project Upgrade

```bash
zhin migrate [--dry-run] [--no-install] [--include-pinned]
```

Upgrades an older Zhin project to the latest: dependencies, scripts and folder structure. `--dry-run` only prints the plan and ends with "nothing was changed"; `--no-install` skips the final `pnpm install`. Dependencies you locked (exact versions such as `1.1.6`, `link:`, `file:`) are kept unless you pass `--include-pinned`. Full upgrade flow: [Compatibility and migration](../operations/upgrades.md).

`zhin migrate` never edits config files. When startup reports `configVersion must be 2`, or `zhin doctor` / `zhin config check` flags a v1 config, stop the Bot and run `zhin migrate instances` (preview) and then `zhin migrate instances --apply`. The preview lists changes by key name without printing configuration values; `--apply` first copies the originals to `.zhin/backups/config-v2-<timestamp>/` (with a `manifest.json`) and prints that path. Restore with `zhin migrate instances --recover rollback`, or copy the files back as listed in the manifest. `zhin runtime migrate` migrates legacy plugin capability code and is unrelated to the config version.

## Plugins

### new: Create a Plugin

```bash
zhin new [plugin-name] [--standalone] [--type normal|service|adapter] [--package-name <npm-name>] [--is-official] [--skip-install]
```

**This is the single official way to create a plugin.** The name must match `/^[a-z][a-z0-9-]*$/`; without arguments it asks interactively.

- **Standalone plugin (an external plugin to publish to npm)**: `npx @zhin.js/cli new my-plugin --standalone` generates `./my-plugin/` in the current directory. No bot project is needed and no `package.json` is modified. The output has the `package.json#zhin` manifest, a `plugin.ts` that default-exports `definePlugin()`, convention directories, `tests/` and `README.md`, and works out of the box with `pnpm test` / `pnpm typecheck` / `pnpm publish`.
- **Local plugin inside a bot project**: run `zhin new my-plugin` (without `--standalone`) at the project root. It generates `plugins/<name>/` and adds it to the root `package.json` `dependencies`.

- The package name defaults to `zhin.js-<name>`. Use `--package-name` for your own name or scope (for example `@me/zhin-plugin-x`). The `@zhin.js/` scope is reserved for official plugins (`--is-official`).
- `zhin.js` and the capability packages (`@zhin.js/command`, `@zhin.js/skill`, and so on) are peerDependencies with a `^x.y.z` range derived from the installed versions. The same versions go into devDependencies for local tests and type checks.
- The build output follows the published package layout ([publishing guide, Chinese](../../contributing/publishing.md)):
  - `src/` holds library code. `pnpm build` compiles it into `lib/` (`.js` + `.d.ts`), and `main`, `types` and `exports` all point at `lib/`.
  - `zhin.entry` is `./plugin.js`; the local runtime falls back to `plugin.ts`. When you pack (`pnpm pack` or publish), `prepack` runs the build and then `scripts/build-runtime-entries.mjs`, which compiles `plugin.ts` and the convention directories into sibling `.js` files and rewrites imports of `src/` to `lib/`. `postpack` removes those generated files again.
  - `files` is a whitelist. It ships only `lib/`, `plugin.js`, the `.js` files in convention directories, `schema.json`, `skills/`, `agents/` and docs. TypeScript sources, tests and configs are not published.

  See [definePlugin · Development entry vs. npm entry](../authoring/define-plugin.md#development-entry-vs-npm-entry).
- The generated `pnpm test` (Vitest) and `pnpm typecheck` (`tsc --noEmit`) work as is; no `NODE_ENV` setting is needed.
- `--skip-install` skips `pnpm install` in both the plugin directory and the project root.

### install / add: Install a Plugin

```bash
zhin install <plugin name or git URL> [--no-enable] [--dry-run]
zhin add ...          # alias of install
```

By default it installs with pnpm and writes the package reference into `plugins.<instanceKey>` in `zhin.config.yml`. Business settings use the top-level alias block; `disable_plugins` controls activation. For adapters, follow the prompt to run `zhin setup --adapters` and add an account.

| Option | Description |
| --- | --- |
| `-S, --save` | Write to `dependencies` (default) |
| `-D, --save-dev` | Write to `devDependencies` |
| `-g, --global` | Install globally (doesn't enable the plugin) |
| `--no-enable` | Install dependencies only; don't change config |
| `--dry-run` | Print the install and config changes without writing |

### uninstall: Uninstall

```bash
zhin uninstall plugin <name> [--remove-pkg]
zhin uninstall adapter <name> [--remove-pkg]
zhin uninstall service
```

`name` can be an npm package name or an instanceKey; `--remove-pkg` also removes the dependency from `package.json`. `uninstall service` removes the system service.

### search / info: Discover Plugins

```bash
zhin search [keyword] [-c utility|service|game|adapter|admin|ai] [-l 20] [--official]
zhin info <package>
```

Search the plugin marketplace or show one plugin's details.

### use-cases: Find a Setup Path by Purpose

```bash
zhin use-cases
zhin use-cases reminder
zhin use-cases personal-reminder
zhin use-cases group-welcome
zhin use-cases keyword-reply
```

Find the required plugin, installation preview, steps and current limitations for reminders, welcome messages and keyword replies. This command only prints a guide: it does not install plugins, change configuration, start the bot or send messages. The existing installation, configuration and chat interfaces still own those operations.

The Console [administrator task center](../paths/console.md#administrator-task-center) uses the same catalog. Its first creation flow manages administrator reminders. Welcome messages and keyword replies currently link to existing setup paths; Console does not impersonate a chat member.

### build: Build a Plugin

```bash
zhin build [plugin] [--clean] [--production] [--analyze]
```

`plugin` is a path relative to `plugins/` (e.g. `adapters/icqq`); when omitted it builds the current package from inside a plugin folder, or every `plugins/*` from the workspace root. `src/` is compiled with tsc and `client/` bundled with esbuild; `--clean` clears `lib/` and `dist/` first; `--production` (on by default) minifies client output.

### plugin check: Check a Plugin Before Publishing

```bash
zhin plugin check [plugin-dir] [--no-pack] [--json] [--strict]
```

Checks whether the plugin in a directory (the current one by default) will publish correctly. Run it once before publishing: `npx @zhin.js/cli plugin check`.

- **Manifest and layout**: checks the `package.json` `name` and `zhin` manifest, and that `zhin.entry` points at JavaScript with a matching source file. It also checks that the `files` whitelist covers the entry, the convention directories (the `.js` built from `commands/`, `tools/` and so on, plus `skills/` and `agents/`) and `schema.json`, and that `prepack` / `postpack` generate and clean the runtime entries. A missing README or missing tests only produce warnings.
- **zhin manifest and dependencies**:
  - the `zhin` manifest (`protocol`, `type`, `entry`, `runtime`, `features`, `plugins`) is validated with the same parser the Runtime uses at load time;
  - `zhin.engine` must be a semver range the current Runtime engine satisfies, and `features[].api` must be a valid range;
  - packages referenced by `features` / `plugins` must be listed in `dependencies` or `peerDependencies`;
  - `peerDependencies` must declare `zhin.js` with real semver ranges: `latest`, `*` and `file:` / `link:` are errors, and a locally installed version outside the range is a warning;
  - Zhin stack packages in `dependencies` produce a warning.
- **Published package**: runs the plugin's real `npm pack` (its `prepack` build included) and unpacks the tarball in a temporary directory. It then checks that:
  - the entry and `main` / `exports` are packed;
  - relative imports in packed JavaScript resolve;
  - no tests or build configuration slipped in;
  - every `.ts` in a convention directory has a packed `.js`;
  - the packed `zhin.entry` can be imported: it is loaded in a child process using the plugin's own `node_modules` (skipped with a warning when dependencies are not installed).

  These are the same rules as the repository's `pnpm check:pack-imports`. `--no-pack` skips this step.
- Exits with code 1 on errors; `--strict` also fails on warnings; `--json` prints a structured result for CI.

### pub: Publish a Plugin

```bash
zhin pub [plugin-name|plugin-dir] [--tag latest] [--access public] [--registry <url>] [--dry-run] [--skip-build] [--skip-check] [--yes]
```

- Inside a standalone plugin from `zhin new --standalone`, run it without arguments to publish the current directory: `npx @zhin.js/cli pub --dry-run` to preview, `npx @zhin.js/cli pub` to publish. (`npx @zhin.js/cli` is reliable with every version; `npx zhin` only means the same CLI from `zhin@4` on, see the tip at the top of this page.)
- The argument can also be any plugin directory (its `package.json` has a `zhin` field), e.g. `zhin pub ../my-plugin`.
- In a bot project root, the argument is a path relative to `plugins/`; without it a single plugin is picked automatically, several are offered interactively.
- `--dry-run` goes through the flow without publishing. Non-interactive shells (CI) need `--yes` to skip the publish confirmation. Packages with `private: true` are rejected, and a `zhin.entry` pointing at `.ts` gets a hint to publish the built `.js`.
- Before publishing it runs [`zhin plugin check`](#plugin-check-check-a-plugin-before-publishing) automatically (`npm pack` included). Errors stop the publish; warnings alone let it continue. Use `--skip-check` to skip it if you really must.
- Full release flow: [Complete plugin delivery](../authoring/plugin-delivery.md).

### packages: Plugin Status and Extension Packages

**Manage skill / extension packages** (ADR 0010):

```bash
zhin packages install <pkg|npm:skill-pack|git:url> [--local]
zhin packages remove <name> [--local]
zhin packages list [--local]
zhin packages update [source] [--local]
```

`--local` (`-l`) installs into the project's `.zhin/packages/` instead of globally. Without an `npm:` / `git:` prefix, it uses the same install flow as `zhin install <package>` and Console.

**Check whether a plugin is really live**: installing doesn't mean it's loaded, its platform is online, or its features are verified. Use these to inspect status and run verification:

```bash
zhin packages status <instanceKey>
zhin packages status <instanceKey> --live http://127.0.0.1:8068
zhin packages verification-plan <instanceKey> --live http://127.0.0.1:8068
zhin packages apply <instanceKey> --live http://127.0.0.1:8068 --project-revision <revision>
zhin packages verify <instanceKey> <check-id> --live http://127.0.0.1:8068 \
  --generation <generation> --project-revision <revision> --check-revision <checkRevision>
```

States returned by `status`:

| State | Meaning |
| --- | --- |
| `installed` | The package resolves |
| `declared` | An instance is declared |
| `missing-config` | Required config or environment variables are missing, or values don't match the schema |
| `pending-restart` | The running version hasn't applied it yet |
| `enabled` | Live, with config and package version consistent |
| `degraded` | Declaration and actual installation disagree, or a dependency check failed |

`readiness` records readiness evidence separately (`unknown` when an adapter is present but there's no platform health evidence); `verification` only says whether business checks exist — **a successful start is not a business pass**.

::: details Live requests, verification flow and concurrency rules
- **Token**: live requests read the Console token from `ZHIN_CONSOLE_TOKEN`, or the variable named by `--token-env <name>`. `verification-plan`, `apply` and `verify` need full permissions. Never put tokens in URLs or command arguments.
- **HTTPS**: remote requests carrying a token must use HTTPS; plain HTTP is allowed only for `localhost`, `127.0.0.0/8` and `::1`.
- **Offline mode**: offline `status` provides only file and package-resolution evidence; an offline verification plan has no current version or runnable checks, and never starts the Runtime.
- **Verification steps**: review the scope and side effects in `verification-plan` first, then pass the returned `generation`, `projectRevision` and `checkRevision` to `verify`. Changes to config, version or check definitions reject old plans. Plugins without checks return `not-configured`; passing local checks doesn't mean platform delivery is verified. `apply` only requests application — confirm with a live `status` afterwards.
- **Schema**: a loaded config schema applies only to the same package version; after an update the on-disk `schema.json` is read. If the new version declares config only in TypeScript with no readable schema, `validation.schemaAvailable` is `false` and only environment references are checked; full validation needs a real Runtime pre-check.
- **Production dependencies**: auto-enabled plugins must be production dependencies; `--save-dev` must be combined with `--no-enable`, and this is checked before installing.
- **Concurrency**: project changes use a file lock and revision checks. Concurrent operations or config drift fail explicitly; if install steps already completed, partial-completion evidence is returned and user changes are never overwritten. If the lock's owning process has exited, the error shows the lock path — delete it after confirming no installer is running, then retry.
:::

## Working with a running bot

These commands talk to a running bot over HTTP, so start it with `zhin runtime start` with the HTTP service enabled first.

### send: Send a Message to a Running Bot

```bash
zhin send <scene_id> [content...] [-s private|group|channel] [-a <adapter>] [-e <endpoint>]
```

`scene_id` is a user ID for DMs or a group number for groups; without `content` it reads one line from stdin. `-a` defaults to `process`; `-e` picks an account ID, defaulting to the adapter's first online account.

### watch: Monitor a Running Instance

```bash
zhin watch [-i 3] [--once] [--json] [--no-clear]
```

Refreshes a status panel in the terminal (stats, accounts, assistant jobs). `--once` fetches once and exits; `--json` suits scripts.

### schedule: Persistent Scheduled Tasks

Have the AI run a prompt at given times. Jobs are stored in `data/schedule-jobs.json`; restart the bot for changes to take effect.

```bash
zhin schedule list
zhin schedule add "0 0 9 * * *" --prompt "Good morning, summarize today's schedule" [--kind solar|lunar|workday|freeDay]
zhin schedule add --every 30m --prompt "Check RSS"
zhin schedule add --at 2026-08-01T09:00:00Z --prompt "One-off reminder"
zhin schedule remove <id>
zhin schedule pause <id>
zhin schedule resume <id>
```

| `add` option | Description |
| --- | --- |
| `--prompt` | Required: the prompt sent to the AI when due |
| `-l, --label` | Job name |
| `--kind` | `solar` (default, Gregorian) / `lunar` / `workday` / `freeDay` |
| `--notify-channel` | `im` / `silent` (default) / `log` |
| cron expression, `--at`, `--every` | Pick one: a six-field cron (sec min hour day month weekday), a one-off ISO8601 time, or an interval (e.g. `30m`, `1h`, `1d`) |

### agent: Agent Diagnostics and Workroom Observation

Requires the AI stack (`@zhin.js/agent` + `zod` + `ai`).

```bash
zhin agent info [--json]
zhin agent workroom runs --project <projectId> [--json]
zhin agent workroom run <runId> --project <projectId> [--json]
zhin agent workroom readiness <runId> --project <projectId> [--json]
zhin agent workroom cancel <runId> --project <projectId> --expected-sequence <n> --reason-code <code> --control-deadline <timestamp> [--operation-id <id>] [--json]
zhin agent workroom request-replan <runId> --project <projectId> --expected-sequence <n> --reason-code <code> [--operation-id <id>] [--json]
```

| Command | Purpose |
| --- | --- |
| `info` | List discovered Agent capabilities and named Agents (Tools, Skills, Hooks…) |
| `workroom runs` / `run` / `readiness` | Connect to the running bot and read Run, Task, Assignment and Blocker state (no content) using the token identity from config |
| `workroom cancel` / `request-replan` | Require the current Project Sponsor permission and use `expected-sequence` to prevent concurrent conflicts. `request-replan` only records the replan request and pauses scheduling; it never pretends a new plan revision exists |

### usage report: Real Usage Ledger

Read-only. Reads `data/agent-traces/*.jsonl` and summarises real model usage per local day, so you can tell whether context optimisations actually saved tokens (ADR 0043 §6). Files are streamed line by line, nothing is written, and malformed lines are counted and reported at the end.

```bash
zhin usage report                                  # today
zhin usage report --days 7                         # last 7 days, including today
zhin usage report --since 2026-10-28 --until 2026-10-29
zhin usage report --session 'icqq:*:group:*' --json
```

| Option | Purpose |
| --- | --- |
| `--days <n>` | Last n days, default 1 |
| `--since <time>` / `--until <time>` | Time range (`--until` exclusive): `2h`, `7d`, `YYYY-MM-DD` (local midnight), ISO time or epoch ms; `--since` overrides `--days` |
| `-s, --session <pattern>` | Session key substring, or a glob with `*` |
| `--json` | JSON output |
| `--cwd <dir>` / `--dir <dir>` | Project root / trace directory |

Per day: turns, model calls, calls per turn and per-call input tokens (p50 / p90 / max), cache-read share (`cache_read_tokens` / `prompt_tokens`), history / fixed / user prompt shares, turns that hit the iteration limit, and the top 5 sessions by input tokens. Segment shares come from each turn's first-request estimate (`context_budget`); fixed = system + tool_schemas + output_schema + tool_index + skill_catalog + agent_catalog + memory + bootstrap. "Hit the iteration limit" means a `last_iteration_nudge` was recorded or the turn ended `budget_exceeded`.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `51` | Console requested a restart (the daemon starts a new process) |
| `75` | The runtime requires a restart (e.g. lockfile changed); the daemon restarts with storm protection |

Process model and hot-reload behavior: [zhin runtime start](./runtime.md).
