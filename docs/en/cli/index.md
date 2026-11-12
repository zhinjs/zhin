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
| Start the bot (dev mode, hot reload on save) | `pnpm dev` (i.e. `zhin start --foreground --watch source config`) |
| Run in the background on a server / inspect / stop | `npx zhin start` / `npx zhin status`, `npx zhin logs -f` / `npx zhin stop` |
| Run under systemd / Docker / PM2 (foreground) | `pnpm start` (i.e. `zhin start --foreground --mode production --no-watch`) |
| Create the first Console owner | `npx zhin console init` (or finish it in the Console with the link printed at startup) |
| Add Console accounts, reset a password | `npx zhin console user create <username> --role viewer` / `npx zhin console user passwd <username>` |
| Connect a platform, configure AI or a database | `npx zhin setup` (optionally `--adapters` / `--ai` / `--database`) |
| Diagnose environment or config problems | `npx zhin doctor` |
| Check the config file is valid | `npx zhin config check` |
| Install a community plugin | `npx zhin install <plugin>` |
| Find plugins and setup steps by purpose | `npx zhin use-cases` |
| Create a new, publishable plugin | `npx @zhin.js/cli new my-plugin --standalone` |
| Check a plugin before publishing | `npx @zhin.js/cli plugin check` |
| Add a local plugin to an existing bot project | `npx zhin new my-plugin` |
| Update dependencies (stop instance → install → start, rolled back on failure) | `npx zhin update` |
| Upgrade Zhin | `npx zhin migrate --dry-run`, then again without `--dry-run` |
| Install as a start-on-boot system service | `npx zhin service install` |

All commands, grouped by purpose, follow.

## Running

### start / stop / restart / status / logs: Gateway and Instance

```bash
zhin start [--foreground] [--mode development|test|production] [--environment <name>]
           [--watch source config | --no-watch] [--once] [--open] [--log-file <path>] [--standalone]
zhin stop [--timeout <ms>]
zhin restart [--gateway]
zhin status [--json]
zhin logs [-f] [-n <1-1000>] [--interval <ms>]
```

`zhin start` starts the management gateway (long-lived; serves HTTP and the Console), which launches the Zhin instance. It runs in the background by default; `--foreground` (`-f`) keeps it attached (development, systemd, containers, PM2). Only `--foreground`, `--once` and `--standalone` run attached: `--mode production` on its own still runs in the background, so process managers must pass `--foreground`. While the gateway runs, the other commands talk to it over the local control socket `.zhin/gateway.sock`: `stop` stops instance and gateway, `restart` restarts only the instance (`--gateway` restarts a background gateway), `status` shows both (exit code 3 when not running), `logs` reads the instance logs. Without a gateway, `stop` / `restart` have nothing to do and `logs` reads `.zhin/logs/instance.log`. Run the management commands as the same system user that started the gateway. Options, exit codes and a systemd example: [zhin start](./runtime.md).

For `zhin update`, see [Update dependencies](#update-update-dependencies) below.

### runtime: Project Tools

```bash
zhin runtime start [...]    # gateway in the foreground; same as zhin start --foreground
zhin runtime inspect
zhin runtime codegen [dir] [--write] [--json]
zhin runtime build
zhin runtime publish [--execute|--resume] [--tag latest]
zhin runtime migrate [extract|cutover|verify|status] [--check|--write]
```

`--watch` and the compatibility flag `--no-watch` are mutually exclusive. Without either, no files are watched.

| Subcommand | Purpose |
| --- | --- |
| `start` | Run gateway and instance in the foreground (alias of `zhin start --foreground`); see [zhin start](./runtime.md) |
| `inspect` | Print the project structure as JSON (plugin list, build plan) |
| `codegen` | Scan the convention directories and print static type declarations for the plugin's capabilities plus a `capabilityGraph` summary; `--write` writes `plugin.capabilities.d.ts` into the target directory and `--json` prints the scan result. `dir` defaults to the current directory |
| `build` / `publish` | Build and publish according to the project structure. `publish` only prints the plan by default; `--execute` runs it, and `--resume` continues after an interruption |
| `migrate` | Generate and apply a project-structure migration plan: `--check` previews, `--write` writes atomically, `status` prints a readiness report |

Scaffolded projects already have these conventional scripts:

```json
{
  "scripts": {
    "dev": "zhin start --foreground --watch source config",
    "start": "zhin start --foreground --mode production --no-watch",
    "stop": "zhin stop"
  }
}
```

### service: System Service

```bash
zhin service install [--user]
zhin service uninstall [--user]
zhin service status [--user]
```

Installs a start-on-boot / supervised service. `--user` uses user-level systemd on Linux; `status` works on Linux and macOS only. The service runs the gateway in the foreground (`zhin start --foreground --mode production --no-watch`); the gateway restarts the instance.

### console: Setup and User Management {#console}

```bash
zhin console init [--status]
zhin console init [--database sqlite|mysql|pg|mongodb] [--database-<field> <value> ...] [--database-password-env <VAR>]
                  [--owner <username>] [--display-name <name>] [--password-stdin] [-y]
zhin console user create <username> [--role viewer] [--display-name <name>] [--password-stdin]
zhin console user passwd <username> [--password-stdin]
zhin console user disable <username>
zhin console user enable <username>
zhin console user list
```

Console users, roles and API tokens live in the project database ([ADR 0049](../../adr/0049-console-rbac.md)). These commands do the same as the Console's setup wizard and Access pages — use them on a server, in a container build, or when a password is lost.

- **Who runs them**: while the project's gateway runs, the commands go to it over the local control socket `.zhin/gateway.sock` (a connection counts as the local owner), so a database switch or a new owner takes effect at once. Without a gateway they open the project database directly (offline setup and rescue). A socket that belongs to another system user or does not answer is an error; the command never edits files behind the gateway's back.
- **`init`** has two steps: choose the database (the current configuration, usually SQLite, is kept by default), then create the first owner. Without flags it asks interactively; `--status` prints the setup state as JSON. Once an owner exists it fails — use `zhin console user` instead.
  - `--database <dialect>` switches database; pass connection fields as `--database-filename`, `--database-host`, `--database-port`, `--database-user`, `--database-database`, `--database-url`, `--database-db-name`, `--database-mode` and so on. The CLI tests the connection first, then writes the configuration and puts secret fields in `.env`.
  - For the password, reference an existing environment variable with `--database-password-env <VAR>` (the config gets `${VAR}`). `--database-password <value>` leaves the secret in shell history and the process list and is not recommended.
  - `--owner` plus `--password-stdin` creates the owner non-interactively (the password is the first line of stdin, at least 10 characters); with `-y`, missing flags fail instead of prompting, for scripts.
- **`user`**: `create` binds the global `viewer` role by default, `--role` takes `owner` / `admin` / `operator` / `viewer` or a custom role; `passwd` resets the password and revokes all of the user's sessions; `disable` / `enable` suspend and restore; `list` prints users, state and role bindings. Adapter- or account-scoped bindings are set in the Console's Access pages.
- `http.token` is only a **bootstrap token**: valid until the first owner exists, refused on every endpoint afterwards.

```bash
# Non-interactive setup in a container or on a server: create the owner before opening the port
printf '%s\n' "$OWNER_PASSWORD" | zhin console init -y --owner admin --password-stdin
printf '%s\n' "$VIEWER_PASSWORD" | zhin console user create alice --role viewer --password-stdin
```

Exit code `0` on success, `1` on failure (already set up, unknown user, database connection failed, missing flags and so on).

## Configuration and diagnostics

### setup: Interactive Configuration Wizard

```bash
zhin setup                 # full wizard
zhin setup --database      # database only
zhin setup --adapters      # adapters only (add accounts)
zhin setup --ai            # AI only
zhin setup -y --adapter sandbox --enable-ai --install   # non-interactive: run only the steps given by flags
zhin setup --decisions     # optional TypeSafe Jev decision service (needs existing AI config)
zhin setup --bootstrap     # bootstrap files only (SOUL.md / TOOLS.md / AGENTS.md)
zhin setup --global        # initialize a global instance in ~/.zhin
zhin setup --locale en     # set the project language (zh-CN or en); combines with the other options
```

The wizard edits the matching parts of [`zhin.config.yml`](../configuration/index.md) and writes secrets to `.env`. Non-interactive flags: `--adapter <name>` (repeatable) adds an adapter, `--enable-ai` enables AI (add model providers later in the Console), `--skip-ai` / `--skip-adapters` skip those onboarding steps, `--install` installs the needed dependencies now (the Console's allowlist), and `-y` asks nothing and runs only the steps given by flags.

Without `--locale` the project's existing language is kept; language and time zone are independent. See [Language and Localization](../configuration/localization.md).

For network databases, the CLI checks the port range, writes connection fields as environment references and puts the real values in `.env`. Afterwards run `npx zhin config check` to catch missing database variables before startup; if the values only live in `.env.production`, use `npx zhin config check --environment production`.

### config: Read and Write Configuration

```bash
zhin config list                       # whole configuration (secrets masked)
zhin config get <key>                  # dotted path ai.enabled or JSON Pointer /plugin/key.with.dot
zhin config set <key> <value>          # value is parsed as JSON, otherwise kept as a string
zhin config unset <key>                # aliases: delete / del
zhin config path                       # print the local config file path
zhin config check [--fix] [--json] [--strict]
```

`get` / `set` / `unset` / `list` **talk to the running Host by default** (`POST {base}/console/request`). A write first reads the config revision, then submits one `config:patch-project`; the Host performs the CAS, schema validation, save and any live application. The CLI never does its own read-modify-write and never retries.

- Connection: `--host <url>` wins, and then the token comes only from `ZHIN_CONSOLE_TOKEN` (or the variable named by `--token-env <name>`). Without `--host` the address is derived from `http.host` / `http.port` / `http.base` (a wildcard bind `0.0.0.0` / `::` connects to `127.0.0.1` / `[::1]`), and only then does an unset variable fall back to `http.token`. Sending a token to a non-loopback address requires HTTPS.
- **If the Host is not running the command fails; it never falls back to writing the file.** For offline edits pass `--offline` explicitly: the same `patchProject` rules as the Host (revision check, plugin declarations are read-only, per-section schema validation) run locally before saving. No Runtime is started, no plugin `setup` runs and the CLI sends no request to the Host, but loading plugin declarations executes module top-level code (which may itself use the network). An offline save is not applied to a running Host until `--watch config` or Console "Apply configuration".
- Reads are masked by schema: `secret` / `writeOnly` / `hidden` / password fields, credential-like keys and unexpanded `${...}` / `env://` references print as `[redacted]`. Pass `--reveal` for raw values.
- With `--json`, `get` / `list` / `set` / `unset` print exactly one line of compact JSON, for scripts; without it they print only human-readable text (`config path` and `config check` have their own formats).
- Exit code `6` also reports `requestId` and `expectedRevision` (in the result object with `--json`, otherwise on stderr) so the write can be verified.

Exit codes are a public contract:

| Code | Meaning |
| --- | --- |
| `0` | Success: saved and applied (or nothing to apply); read succeeded; an `--offline` save (not yet applied to a running Host) |
| `3` | Saved; some settings take effect after a process restart |
| `4` | Revision conflict: changed elsewhere, not saved; the latest (masked) values are printed (values under schema branches that cannot be proven safe, such as `if`/`not`/`contains`, a nested `$id` or a non-local `$ref`, are masked whole) |
| `5` | Validation failed (including rejected plugin-declaration writes): when not saved, field paths are printed; also returned when the file was saved but failed validation before applying, so check with `zhin config get` |
| `6` | Unknown: the write was sent but no definitive receipt arrived (including non-authoritative errors such as a gateway 502/504), or it was saved but the application result is unconfirmed. `requestId` / `expectedRevision` are reported; check with `zhin config get` first; **do not blindly retry** |
| `7` | Not connected to a running Host: nothing was sent, the file is unchanged |
| `1` | Any other error: usage, missing key, authentication (401/403), an authoritative Host rejection (not saved); or **saved but not applied** (superseded by a newer revision, or a group failed/was blocked; the file was written) |

`config check` validates the config file, and `--fix` repairs fields that can be migrated safely. Missing database connection variables are always errors; other warnings become errors with `--strict`, which suits CI.

### doctor: Environment Diagnostics

```bash
zhin doctor [--fix] [--upgrade-l4]
zhin doctor --live <host-url> [--json]
```

Checks Node, ports, tokens, config and other environment issues; `--fix` repairs what it can; `--upgrade-l4` diagnoses what's needed to go from a minimal project to the full AI stack. `--live` reads a running Host's readiness report (needs an API token with `status.view` in `ZHIN_CONSOLE_TOKEN`; put a custom `http.base` in the URL path) and `--json` prints it as JSON; exit code `0` when ready, `1` otherwise. See [Production](../operations/production.md). When `--fix` adds dependencies it writes the real version ranges released alongside the CLI (e.g. `^1.1.11`), never `latest`; run `pnpm install` afterwards.

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

`zhin migrate` never edits config files. When startup reports `configVersion must be 2`, or `zhin doctor` / `zhin config check` flags a v1 config, use `zhin migrate instances`, described [below](#migrate-instances). `zhin runtime migrate` migrates legacy plugin capability code and is unrelated to the config version.

#### migrate inference: Migrate legacy AI model configuration

```bash
zhin migrate inference [--mapping <file>] --output migration.json     # offline preview
zhin migrate inference --apply migration.json --maintenance --backup-confirmed [--with-credentials]
zhin migrate inference --finalize migration.json --maintenance --backup-confirmed
zhin migrate inference --sessions-only --mapping <file> --output <file>   # only bind old Sessions to existing Profiles
```

Previews and migrates the legacy `ai.providers`-style model configuration and Sessions offline; it loads no `.env` and does not start the Bot. `--apply` and `--finalize` both require `--maintenance` (the Bot is stopped) and `--backup-confirmed` (the configuration, database, and encryption master key are backed up). For a non-SQLite database, `--state-snapshot <file>` supplies the old metadata and `--database-config <file>` an offline database connection. Full steps and recovery boundaries: [Provider interface upgrade](../ai/provider-upgrade.md).

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

By default it installs with pnpm and writes the package reference into `plugins.<instanceKey>` in `zhin.config.yml`. Business settings use the top-level alias block; `disable_plugins` controls activation. When the plugin schema has required fields without defaults (such as an adapter's `endpoints` accounts), only the dependency is installed, nothing is declared, and the missing fields are printed: fill them in the Console and declare the plugin there (`gateway.plugins.declare`), run `zhin setup --adapters`, or add `plugins.<instanceKey>` and the instance block to the config file yourself and restart.

| Option | Description |
| --- | --- |
| `-D, --save-dev` | Write to `devDependencies` |
| `-g, --global` | Install globally (doesn't enable the plugin) |
| `--no-enable` | Install dependencies only; don't change config |
| `--dry-run` | Print the install and config changes without writing |

While the gateway runs (`zhin start`), the install goes through the gateway's dependency transaction: the instance is stopped, the package manager runs, then the instance starts and must report ready; on failure `package.json`, the lockfile and the config are restored and the old version is started again. Progress is streamed to the terminal. Through the gateway only npm registry packages (`name` or `name@range`) can be installed; git URLs, local paths and `--save-dev` need `zhin stop` first. Without a gateway the install runs directly in the project.

### uninstall: Uninstall

```bash
zhin uninstall plugin <name> [--remove-pkg]
zhin uninstall adapter <name> [--remove-pkg]
```

`name` can be an npm package name or an instanceKey; `--remove-pkg` also removes the dependency from `package.json`. While the gateway runs, the uninstall goes through it (instance stopped and started, rolled back on failure). Remove the system service with `zhin service uninstall`.

### update: Update Dependencies

```bash
zhin update [package | package@exact-version ...]
```

Without package names every dependency is updated (`pnpm update`). While the gateway runs the same transaction goes through it (stop instance → update → start instance, rolled back on failure); otherwise it runs directly.

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

### preview: Preview Components and Pages

```bash
zhin preview [dir] [-p 4176] [-H 127.0.0.1] [--open]
zhin preview --export preview.html     # export a single-file static HTML snapshot and exit
zhin preview --json                    # print the scan and render result and exit
```

Starts a local preview workbench: it scans `components/*` and `pages/*` in the project or plugin directory (the current directory by default), hot-reloads, and lets you edit Props and adjust styles live. It listens on `127.0.0.1:4176` by default; `--open` opens the browser after startup.

### build: Build a Plugin

```bash
zhin build [plugin] [--clean] [--no-production]
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

These commands talk to a running bot over HTTP, so start it with `zhin start` with the HTTP service enabled first. Requests carry the Console API token from `ZHIN_CONSOLE_TOKEN` (issued in your Console account settings, never more than your own permissions); after Console setup `http.token` is always refused, so without an API token these commands get 401.

### send: Send a Message to a Running Bot

```bash
zhin send <scene_id> [content...] [-s private|group|channel] [-a <adapter>] [-e <endpoint>]
```

`scene_id` is a user ID for DMs or a group number for groups; without `content` it reads one line from stdin. `-a` may be omitted only when the instance has a single adapter; `-e` picks an account ID, defaulting to the adapter's first online account.

### watch: Monitor a Running Instance

```bash
zhin watch [-i 3] [--once] [--json] [--no-clear]
```

Refreshes a status panel in the terminal (stats, accounts, assistant jobs). `--once` fetches once and exits; `--json` suits scripts.

### schedule: Persistent Scheduled Tasks

Have the AI run a prompt at given times. The command talks to the running instance through the Host API and takes effect immediately; the bot must be started with `zhin start` and have `assistant.enabled`.

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

### agent: Agent Diagnostics

Requires the AI stack (`@zhin.js/agent` + `zod` + `ai`).

```bash
zhin agent info [--json]
```

| Command | Purpose |
| --- | --- |
| `info` | List discovered Agent capabilities and named Agents (Tools, Skills, Hooks…) |

### trace: Inspect Agent Turns

Requires the AI stack. After the bot finishes each AI conversation turn, it appends that turn's trace to `data/agent-traces/<UTC date>.jsonl` (one file per day). You no longer need to dig through `bot.db` and the journal to diagnose a problem:

```bash
zhin trace                       # same as zhin trace last: print the most recent turn
zhin trace <turnId>              # a specific turn; an id prefix is enough
zhin trace --list                # list recent turns (50 by default)
zhin trace --sessions            # list sessions that have traces
zhin trace --session qq:bot:private:12345 --since 2h   # one session's turns in the last 2 hours
zhin trace --list --since 2026-10-14 --until 2026-10-15 -n 200
zhin trace last --json
zhin trace --engagements --list   # list recent multi-Agent collaborations (Engagements)
zhin trace --engagements          # collaboration graph of the latest collaboration
zhin trace <engagementId>         # a specific collaboration; an id prefix is enough
```

| Option | Purpose |
| --- | --- |
| `-l, --list` | One line per turn: time, end status, turn id, session, tool count, tokens |
| `--sessions` | One line per session: turn count, last time and status, total tokens |
| `--engagements` | Read multi-Agent collaboration records instead (the `engagement_events` database table; requires SQLite, MySQL, or PostgreSQL): with `--list`, list recent collaborations; otherwise show the participants, mail hops, Blackboard, and budget of the latest or the given collaboration. See [Multi-Agent Collaboration and Venues](../ai/multi-agent-harness.md) |
| `-s, --session <key>` | Only this session (sessionKey); output switches to the list format |
| `--since <time>` / `--until <time>` | Time range (`--until` exclusive): `30m`, `2h`, `7d` (how long ago), an ISO date/time, or epoch ms |
| `-n, --limit <n>` | Show at most the latest n entries, default 50 |
| `--json` | Raw JSON output (snake_case fields) |
| `--no-timeline` | Do not print the step-by-step timeline |
| `--cwd <dir>` | Project root, default current directory |
| `--dir <dir>` | Read a trace directory directly (a failed eval report prints this argument) |

A trace contains: the initiator and role, the session, tokens for each model call, each tool call (argument summary, duration, result size, error or refusing policy), budget extensions and automatic continuation, nested sub-agent turns, per-segment context cost, and the end reason. The output starts by calling out the **first failing step**.

**Retention and redaction.** Traces are kept for 7 days with a 64 MB total cap by default: cleanup runs at startup and every hour after that, first deleting expired date files and then deleting from the oldest day until the total is under the cap (today's file is never deleted for size). Adjust with the `ZHIN_TRACE_RETENTION_DAYS` and `ZHIN_TRACE_MAX_MB` environment variables. A trace stores summaries only: tool results record only their length, not their content; tokens, passwords, `Authorization`, and similar fields in arguments and error messages are replaced with `[redacted]`, and before writing to disk inline credentials (`sk-…`, `Bearer …`, and so on) and secret values from environment variables are scanned once more. The legacy `data/agent-traces/recent.json` is still read.

**Console page.** The "Agent Trace" page in Console (`/console/agent-trace`) reads the same data: session list → turn list → turn detail (model/tool call waterfall, timeline, and raw record), with time filtering, and `?turn=<turnId>` opens a turn directly. Add one page to your project to enable it:

```tsx
// pages/agent-trace/index.tsx
import { TraceArchivePage } from '@zhin.js/client';
import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({ title: 'Agent Trace', icon: 'Activity', order: 31 });
export default TraceArchivePage;
```

Behind the page are the read-only endpoints `GET /api/agent/trace-archive/sessions`, `/turns?sessionKey=&since=&until=&limit=`, and `/turn?turnId=`. They require `agent.view`; an account or API token without it gets 403.

**Eval integration.** A failing case in `pnpm eval:agent` writes its turn trace to `ZHIN_EVAL_TRACE_DIR` (by default `zhin-eval-traces` under the system temp directory), and the report prints one `↪ zhin trace <turnId> --dir …` line per turn that you can copy and run.

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
| `0` | Normal exit |
| `3` | `zhin status`: the gateway is not running |
| `130` | Interrupted by a signal |
| other non-zero | The gateway failed to start (port in use, a gateway already runs for the project, unsupported Node version, unreadable config), or a management command failed (socket owned by another user, gateway not answering, transaction rolled back). An instance crash does not end the gateway: the gateway restarts it, and restarts are requested over the control channel, not through exit codes |

`zhin config` and `zhin doctor --live` have their own exit codes (above). Process model, exit codes per start mode and hot-reload behavior: [zhin start](./runtime.md).

## Migrating app instance declarations {#migrate-instances}

An older project must stop the Bot first and then migrate to `configVersion: 2`. The command only previews by default and neither installs dependencies nor starts plugins:

```bash
zhin migrate instances
zhin migrate instances --apply
zhin migrate instances --recover continue
zhin migrate instances --recover rollback
```

The preview lists changes by key name (the added `configVersion`, the `plugins` mapping, moved business blocks, `disable_plugins`, and the emptied `package.json#zhin.plugins`) without printing any configuration value, so it can be pasted into an issue; `--json` prints a machine-readable summary. Before writing, `--apply` copies the original files to `.zhin/backups/config-v2-<timestamp>/` (with a `manifest.json`) and prints the path. Prefer `zhin migrate instances --recover rollback` to restore; you can also copy the files back by hand following the manifest. Nesting, optional plugins, and alias collisions need manual handling. See the [migration guide](../migrations/plugin-instance-declarations.md).
