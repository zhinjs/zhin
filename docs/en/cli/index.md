---
title: "CLI Reference"
description: "Every zhin subcommand: start and stop, the setup wizard, installing and publishing plugins, diagnostics, messaging a running bot, schedules and system services"
---

# CLI reference

Day to day, working with Zhin mostly means working with one command, `zhin`: start the bot, change config, install plugins, diagnose problems. It comes from `@zhin.js/cli` and is called in a project as `npx zhin …` or `pnpm exec zhin …`. Creating a new project uses a separate command, `npm create zhin-app`.

```bash
npx zhin --help        # list every command
```

Command results (lists, details) go to stdout without a log prefix, so they can be piped; progress and diagnostics go to stderr. The global `--verbose` option adds the `[time][LEVEL] [CLI]` prefix to diagnostic lines; `--debug` shows the log correlation id when a running instance answers with an internal error, and finds the matching line in the instance log.

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
| Turn a plugin off / on again without uninstalling it | `npx zhin disable <instanceKey>` / `npx zhin enable <instanceKey>` |
| Find plugins and setup steps by purpose | `npx zhin use-cases` |
| Create a new, publishable plugin | `npx @zhin.js/cli new my-plugin --standalone` |
| Check a plugin before publishing | `npx @zhin.js/cli plugin check` |
| Add a command, middleware, tool… file to a plugin | `npx zhin create command hello` |
| Add a local plugin to an existing bot project | `npx zhin new my-plugin` |
| Update dependencies (stop instance → install → start, rolled back on failure) | `npx zhin update` |
| Upgrade Zhin | `npx zhin migrate --dry-run`, then again without `--dry-run` |
| Install as a start-on-boot system service | `npx zhin service install` |

All commands, grouped by purpose, follow.

Dates and times in command output are always local time as `2026-11-15 00:15:56` (24-hour; `2026-11-15` for a date alone), in both display languages: ISO order cannot be misread on either side of the Atlantic (unlike `11/15/2026` or `15/11/2026`), sorts as text and matches the days of `zhin usage report`.

## Running

### start / stop / restart / status / logs: Gateway and Instance

```bash
zhin start [--foreground] [--mode development|test|production] [--environment <name>]
           [--watch source config | --no-watch] [--once] [--open] [--log-file <path>] [--standalone]
zhin stop [--timeout <ms>]
zhin restart [--gateway]
zhin status [--json]
zhin logs [-f] [-n <N>] [--level debug|info|warn|error] [--since <time>] [--until <time>]
          [--grep <text>] [--name <logger>] [--interval <ms>]
```

`zhin start` starts the management gateway (long-lived; serves HTTP and the Console), which launches the Zhin instance. It runs in the background by default; `--foreground` (`-f`) keeps it attached (development, systemd, containers, PM2). Only `--foreground`, `--once` and `--standalone` run attached: `--mode production` on its own still runs in the background, so process managers must pass `--foreground`. While the gateway runs, the other commands talk to it over the local control socket `.zhin/gateway.sock`: `stop` stops instance and gateway, `restart` restarts only the instance (`--gateway` restarts a background gateway), `status` shows both (exit code 3 when not running), `logs` reads the instance logs. Without a gateway, `stop` / `restart` have nothing to do and `logs` reads `.zhin/logs/instance.log`. Run the management commands as the same system user that started the gateway. `start` / `restart` run only at the project root (the project root is a directory with a `package.json` plus `zhin.config.*` (in the current directory `config.*` counts too) or a `package.json` that depends on `zhin.js`; a pnpm workspace member belongs to its workspace root, and a stray `config.json` in a parent directory does not count; a directory with only a config file and no `package.json` is not a project and is told to add one): outside a project they suggest `npm create zhin-app`, in a sub-directory of a project (such as `plugins/x/`) they name the project root and the command to re-run there with the same arguments (paths with spaces quoted); all of these exit with code 1 and write nothing. Several config files at the root are an error too, asking you to keep one. Options, exit codes and a systemd example: [zhin start](./runtime.md).

A log line reads `[2026-11-15 09:00:01.234][WARN] [logger] message`: files and pipes carry the date, a terminal shows only the time. Fields are written as `action | key: value | flag` (e.g. `usage_persist | status: failed | detail: …`).

Without filters `zhin logs` shows the last `-n` lines (default 200, at most 1000). With a filter it searches `.zhin/logs/instance.log` and its rotated files `instance.log.1`…, not limited by the gateway's 1000-line buffer, and `-n` is the number of matching lines (at most 100000):

- `--level warn`: WARN and above (ERROR);
- `--since` / `--until`: `10m`, `1h`, `2d` (before now), `09:00` (today), `2026-11-15 09:00` or an ISO time with a zone. Log lines carry no time-zone offset: their times, and values written without a zone, are read in the local time zone of the machine running `zhin logs` (matching only when it shares the instance's machine and zone); lines written before the upgrade have a time but no date and are skipped, with a count at the end;
- `--grep`: lines containing the text, case-insensitive;
- `--name`: the leading `[logger]` segment; `icqq` also matches `icqq:12345`. Log lines carry no plugin name, so to see one plugin's logs use its logger name.

Continuation lines such as stack traces follow the entry above them; when `--grep` hits a continuation line, the entry line it belongs to is printed first. `-f` works with filters and prints only matching new lines. The log is text, so there is no `--json`.

```bash
# Did the 9 o'clock job run, and did anything fail around it?
zhin logs --since 08:55 --until 09:10 --level warn
zhin logs --name icqq --grep reconnect -f
```

For `zhin update`, see [Update dependencies](#update-update-dependencies) below.

### runtime: Project Tools

```bash
zhin runtime start [...]    # gateway in the foreground; same as zhin start --foreground
zhin runtime inspect [--json]
zhin runtime codegen [dir] [--write] [--json]
zhin runtime build [--json]
zhin runtime publish [--execute|--resume] [--tag latest] [--json]
zhin runtime migrate [extract|cutover|verify|status] [--check|--write]
```

`--watch` and the compatibility flag `--no-watch` are mutually exclusive. Without either, no files are watched.

| Subcommand | Purpose |
| --- | --- |
| `start` | Run gateway and instance in the foreground (alias of `zhin start --foreground`); see [zhin start](./runtime.md) |
| `inspect` | Print a table of plugin instances: instance, package, source (workspace / node_modules), enabled state and feature count; instances in `disable_plugins` are listed too and marked disabled. `--json` prints the full structure (each instance's features and child plugins, build order, disabled instances) |
| `codegen` | Scan the convention directories and print static type declarations for the plugin's capabilities plus a `capabilityGraph` summary; `--write` writes `plugin.capabilities.d.ts` into the target directory and `--json` prints the scan result. `dir` defaults to the current directory |
| `build` / `publish` | Work on the whole workspace in dependency order (for a single plugin use `zhin build` / `zhin pub`). Both print the plan first: which packages and versions, and which packages are skipped and why (no `build` script / `private: true`); an empty plan is stated explicitly. `publish` is a dry run by default (prints the plan and runs `pnpm publish --dry-run`); `--execute` publishes every non-private package to npm (needs an npm login; published under a temporary dist-tag first, moved to `--tag` once all succeed), records progress in `.zhin/publish-journal.json`, and `--resume` continues after an interruption. `--json` prints only the plan (with an `empty` field) and runs nothing. An empty dry-run plan exits 0; an empty plan under `--execute` / `--resume` exits 1 |
| `migrate` | Generate and apply a project-structure migration plan: `--check` previews, `--write` writes atomically, `status` prints a readiness report |

Scaffolded projects already have these conventional scripts (`zhin migrate` gives an upgraded project exactly this set, adding the missing ones and leaving existing ones alone):

```json
{
  "scripts": {
    "dev": "zhin start --foreground --watch source config",
    "start": "zhin start --foreground --mode production --no-watch",
    "stop": "zhin stop",
    "preview": "zhin preview",
    "build": "tsc --noEmit"
  }
}
```

To run in the background use plain `zhin start` (it backgrounds by default); no separate `daemon` script is needed.

### service: System Service {#service}

```bash
zhin service install [--user]
zhin service start|stop|restart [--user]
zhin service status [--user]
zhin service uninstall [--user]
```

The one recommended way to run the bot as a service and start it on boot ([ADR 0062 §2](../../adr/0062-one-path-per-task.md), Chinese). `install` generates the service file for the current system: a systemd unit on Linux (`--user` installs and enables a user unit; without it the unit goes to `.zhin/service/` and the `sudo` commands are printed), `~/Library/LaunchAgents/com.zhinjs.<project>.plist` loaded with `launchctl bootstrap` on macOS, and a Task Scheduler XML plus `schtasks` / NSSM commands on Windows.

The file records the **current** absolute `node` path and the project's `node_modules/@zhin.js/cli/bin/zhin.js`, without `npx`, so a Node installed by nvm / fnm / volta starts at boot; run `zhin service install` again after changing Node versions or moving the project. The service runs the gateway in the foreground (`zhin start --foreground --mode production`) and **restarts it only after a failure** (systemd `Restart=on-failure`, launchd `KeepAlive.SuccessfulExit=false`): after `zhin stop` or `zhin service stop` the bot stays stopped until the next boot / login or `zhin service start`.

When `zhin stop` meets a foreground gateway run by a service: with a legacy service file (`Restart=always` / `KeepAlive: true`, which would start the gateway again at once) it refuses and points to `zhin service stop` or a fresh `zhin service install`; with a current file it stops and says when the bot starts again. The scaffold no longer writes service files; the `.service`, `.plist`, `install-service.ps1` and `*-task.xml` files in older project roots are unused and can be deleted.

Service files cannot contain control characters: `zhin service install` fails when the project path contains a newline or similar. The commands printed for you to copy are quoted for their shell (POSIX single quotes on Linux / macOS, PowerShell single quotes on Windows), and a target service file that is a symbolic link is not written.

Windows limitations (unchanged in this release):
- The scheduled task uses the `InteractiveToken` logon type, so **it does not start after boot until a user logs on**; use NSSM when the bot must run without a logged-on user.
- The task's `RestartOnFailure` only retries when the task **fails to start**; a gateway that crashes while running is not started again.
- `zhin service stop` uses `schtasks /End`, which **terminates** the process: the gateway cannot stop the instance gracefully.
- NSSM installs a Windows service; `zhin service start|stop|restart` only control the scheduled task, so manage the NSSM service with `nssm start|stop|restart <name>`.

### db: restricted account of the Console SQL editor {#db}

```bash
zhin db console-role [--print-sql] [--role <name>]
```

On PostgreSQL / MySQL the Console SQL editor runs only on a separately logged-in restricted account ([ADR 0059](../../adr/0059-gateway-storage-isolation.md), Chinese). This command creates it with the main account (default name `zhin_console_<project hash>`), writes a random password to `.env` (`ZHIN_DB_CONSOLE_USER` / `ZHIN_DB_CONSOLE_PASSWORD`) and references it from `database.console`; running it again rotates the password. When the main account may not create accounts, add `--print-sql`: nothing is created, the SQL is printed for a DBA (the password is the placeholder `<ZHIN_DB_CONSOLE_PASSWORD>`, the real value is in `.env`). It refuses while the project database still holds the old Console account tables — migrate first. Then `zhin restart`. `zhin doctor --fix` does the same. SQLite needs none. See [configuration: `database.console`](../configuration/index.md#database-console).

### console: Setup and User Management {#console}

```bash
zhin console init [--status [--json]] [--reset-store]
zhin console init [--database sqlite|mysql|pg|mongodb] [--database-<field> <value> ...]
                  [--database-password-env <VAR> | --database-password-stdin]
                  [--owner <username>] [--display-name <name>] [--password-stdin] [-y]
zhin console user create <username> [--role viewer] [--display-name <name>] [--password-stdin]
zhin console user passwd <username> [--password-stdin]
zhin console user disable <username>
zhin console user enable <username>
zhin console user list [--json]
zhin console migrate [--revert]
```

Console users, roles, sessions, API tokens and the audit log live in the gateway's own `.zhin/gateway.db` ([ADR 0049](../../adr/0049-console-rbac.md), [ADR 0059](../../adr/0059-gateway-storage-isolation.md)), not in the project database. These commands do the same as the Console's setup wizard and Access pages — use them on a server, in a container build, or when a password is lost.

- **Which project**: the commands look up the tree from the current directory for the project root (the same rule as `zhin start`: the project root is a directory with a `package.json` plus `zhin.config.*` (in the current directory `config.*` counts too) or a `package.json` that depends on `zhin.js`; a pnpm workspace member belongs to its workspace root, and a stray `config.json` in a parent directory does not count), so a run from a sub-directory such as `plugins/x/` still uses the root's `.zhin/gateway.db`; the store actually used is printed on stderr (`账号库：…`). Outside any project they suggest `npm create zhin-app` and exit with code 1 without creating files.
- **Who runs them**: while the project's gateway runs, the commands go to it over the local control socket `.zhin/gateway.sock` (a connection counts as the local owner), so a database switch or a new owner takes effect at once. Without a gateway they open `.zhin/gateway.db` directly (offline setup and rescue), after moving over the account tables an earlier version left in the project database. A socket that belongs to another system user or does not answer is an error; the command never edits files behind the gateway's back.
- **`init`** has two steps: choose the database (the current configuration, usually SQLite, is kept by default), then create the first owner. Without flags it asks interactively; `--status` describes the setup state and the current database in a few lines, and `--status --json` prints it as JSON for scripts. Choosing the database already in use (for example `--database sqlite` on the default SQLite) writes nothing, shows no migration notice and does not restart the instance. Once an owner exists it fails — use `zhin console user` instead.
  - `--database <dialect>` switches database; pass connection fields as `--database-filename`, `--database-host`, `--database-port`, `--database-user`, `--database-database`, `--database-url`, `--database-db-name`, `--database-mode` and so on. The CLI tests the connection first, then writes the configuration and puts secret fields in `.env`.
  - There are two recommended ways to pass the database password (use only one source): `--database-password-env <VAR>` references an existing environment variable (the config gets `${VAR}`); `--database-password-stdin` reads the first line of stdin, stores it in `.env` and writes `${VAR}` into the config. Together with `--password-stdin`, the first line is the database password and the second the owner password.
  - `--database-password <value>` still works but is **not recommended**: the secret stays in shell history and the process list (`ps`), and the command prints a warning.
  - `--owner` plus `--password-stdin` creates the owner non-interactively (the password is the first line of stdin, or the second line together with `--database-password-stdin`; at least 10 characters); with `-y`, missing flags fail instead of prompting, for scripts.
  - When standard input is not a terminal (a pipe, `< /dev/null`, CI), `init` / `user create` / `user passwd` / `init --reset-store` never start an interactive prompt: they fail at once (exit code 1) and point to `--password-stdin` / `--owner` / `--yes`. `zhin setup`, `zhin onboard` and `zhin install` without a plugin name do the same.
- **`user`**: `create` binds the global `viewer` role by default, `--role` takes `owner` / `admin` / `operator` / `viewer` or a custom role; `passwd` resets the password and revokes all of the user's sessions; `disable` / `enable` suspend and restore; `list` prints username, display name, state, role bindings and the **user id** (`ai.personalPrincipals` keys are `user:<user id>`); `--json` prints `{ users: [{ id, username, displayName, disabled, roles }] }`. Adapter- or account-scoped bindings are set in the Console's Access pages.
- **`init --reset-store`**: when `.zhin/gateway.db` was lost or replaced (the project database's marker `zhin_gateway_store` names another store) the Console stays closed; once you accept that the old accounts are gone, this resets it (gateway stopped first, asks for confirmation, `--yes` skips it), records the reset in the new audit log and continues with setup.
- **`migrate`** moves the Console account tables an earlier version kept in the project database into `.zhin/gateway.db` (the gateway also does it when it starts; while a gateway runs the command only reports the state). `--revert` writes them back into the project database and empties gateway.db — required before downgrading, with the gateway stopped (`zhin stop`). See the [upgrade notes](../migrations/gateway-storage.md).
- `http.token` is only a **bootstrap token**: valid until the first owner exists, refused on every endpoint afterwards.

```bash
# Non-interactive setup in a container or on a server: create the owner before opening the port
printf '%s\n' "$OWNER_PASSWORD" | zhin console init -y --owner admin --password-stdin
printf '%s\n' "$VIEWER_PASSWORD" | zhin console user create alice --role viewer --password-stdin
# Switch to PostgreSQL: database password on line 1, owner password on line 2, neither on the command line
printf '%s\n%s\n' "$PG_PASSWORD" "$OWNER_PASSWORD" | zhin console init -y --database pg \
  --database-host db --database-user zhin --database-database zhin \
  --database-password-stdin --owner admin --password-stdin
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
zhin setup --bootstrap     # bootstrap files only (SOUL.md / TOOLS.md / BOT.md; an existing AGENTS.md without BOT.md is kept as the bot file)
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

- Connection: without `--host` the command only uses **this project's gateway** over its local control socket (`.zhin/gateway.sock`), as the local owner (or as the `ZHIN_CONSOLE_TOKEN` principal when that is set). When this project's gateway is not running the command fails with "本项目的网关未运行" (start it with `zhin start`, or pass `--offline`) and does **not** connect to `127.0.0.1:<http.port>`, where another project's gateway may be listening. To reach another address pass `--host <url>` explicitly; the token then comes from `ZHIN_CONSOLE_TOKEN` (or the variable named by `--token-env <name>`). A loopback `--host` (`127.0.0.1` / `localhost` / `[::1]`) is checked first: if its `/pub/health` reports a different project id the command refuses without sending the request or the token. A target that reports **no** project id (an older gateway or a `--standalone` instance) is refused the same way, with a non-zero exit: upgrade that gateway and start this project with `zhin start`, or, if you are sure of the target, pass `--allow-unverified-host` to continue with a warning only (it never accepts a different project id). Sending a token to a non-loopback address requires HTTPS. `zhin send`, `zhin schedule`, `zhin watch` and `zhin packages … --live` follow the same rules (the first three also accept `--host <url>`; all of them accept `--allow-unverified-host`).
- **If the Host is not running the command fails; it never falls back to writing the file.** For offline edits pass `--offline` explicitly: the same `patchProject` rules as the Host (revision check, plugin declarations are read-only, per-section schema validation) run locally before saving. No Runtime is started, no plugin `setup` runs and the CLI sends no request to the Host, but loading plugin declarations executes module top-level code (which may itself use the network). An offline save is not applied to a running Host until `--watch config` or Console "Apply configuration".
- Writing a secret field (marked secret / writeOnly / password in the schema, or a token / password-like key) stores the value in the project's `.env` and keeps or puts a `${VAR}` reference in the config: the variable the field already referenced (such as `${HTTP_TOKEN}`), or a name derived from the path (`http.token` → `HTTP_TOKEN`, `_2` on a clash); a variable already defined in `.env.<environment>` is written there. The output names the variable and never echoes the value. Add `--plain` to write the literal into the config file on purpose (a warning is printed). Console saves follow the same rule.
- Reads are masked by schema: `secret` / `writeOnly` / `hidden` / password fields, credential-like keys and unexpanded `${...}` / `env://` references print as `[redacted]`. Pass `--reveal` for raw values.
- With `--json`, `get` / `list` / `set` / `unset` print exactly one line of compact JSON, for scripts; without it they print only human-readable text (`config path` and `config check` have their own formats).
- Exit code `6` also reports `requestId` and `expectedRevision` (in the result object with `--json`, otherwise on stderr) so the write can be verified. Other failures show only the reason; the global `--debug` option adds both to stderr.
- A write that cannot apply explains why: an unknown key lists the closest settings; an array index past the end states the current length and how to append (read the whole array, add the item, write it back). When `http.port` in the config is broken and no gateway is running, the CLI says to repair it with `--offline` first.

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

Checks Node, ports, tokens, config and other environment issues. Outside the project root (the same rule as `zhin start`) it checks only Node and pnpm (with `--upgrade-l4` too) and then reports a 「Zhin 项目」 error, exiting with code 1: outside any project it suggests `npm create zhin-app`, in a sub-directory it names the project root; `--fix` then writes nothing, and the diagnosis itself never creates `.zhin/`. `--fix` repairs what it can, still lists the manual fix of every item it cannot repair, and says so when it could repair nothing; 「所有检查通过」 is never printed while a warning exists. While the gateway runs, every Console attention item and every source that could not be read is a warning, and a running gateway older or newer than the installed `@zhin.js/gateway` gets the restart command; without a running gateway, the failures recorded in `.zhin/runtime-failures.json` are shown as 「上次运行」 (last run): the instance (zhin.js) writes the latest failure of each model account, adapter account and MCP server there while it runs and removes it once that subject recovers; when nothing is recorded, or the instance version does not write the file yet, nothing is shown and nothing is reported. The TypeScript check reads the project's own `node_modules/typescript` and the range `package.json` declares, not a global `tsc` on PATH. The single-instance check names who requires each copy, e.g. `zhin.js ×2：1.4.0 ← 根项目；1.2.0 ← plugins/foo ("~1.2.0")`, with the concrete fix (which `package.json` to edit, or `zhin migrate`); when a copy comes in through other installed packages, it first follows the chain to the direct dependency of the root or of a workspace member that drags the old release in (e.g. `@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0 → @zhin.js/plugin-runtime@1.1.9`), and `pnpm.overrides` is only the last suggestion. The retired-packages check reads the `package.json` of the root and of every workspace member: a direct dependency on a merged or removed `@zhin.js` package (such as `@zhin.js/config-yaml`, merged into `@zhin.js/runtime` as `YamlConfigDocument`) is a warning that names the replacement and tells you to remove the dependency; an import of a deleted subpath in the project's sources (such as `@zhin.js/agent/tools`: import `defineAgentTool` from `@zhin.js/tool`) is a warning too, with file and line; the last releases of these packages still depend on old Zhin packages, so an override only hides them. The full list is in [Merged and retired packages](../migrations/retired-packages.md). `--upgrade-l4` diagnoses what's needed to go from a minimal project to the full AI stack. `--live` reads a running Host's readiness report (needs an API token with `status.view` in `ZHIN_CONSOLE_TOKEN`; put a custom `http.base` in the URL path) and `--json` prints it as JSON; exit code `0` when ready, `1` otherwise. See [Production](../operations/production.md). When `--fix` adds dependencies it writes the real version ranges released alongside the CLI (e.g. `^1.1.11`), never `latest`; run `pnpm install` afterwards. When the project has `@zhin.js/gateway`, `doctor` also loads the gateway's `node-pty` from the project directory: when that fails (usually because pnpm skipped its build script) it warns with the repair command, and the Console's local terminal is unavailable. See [Build scripts of the native dependencies](../console/operations.md#native-build).

When the HTTP port is taken by something other than this project's gateway (as reached over its control socket), `doctor` sends one request without any credentials to `/pub/health` on the configured `http.host` and TLS setting (`0.0.0.0` / `::` become loopback) and tells apart another project's Zhin gateway, another gateway of this project (control socket unusable), a Zhin instance run without a gateway, and other programs (a refused connection, a failed TLS handshake — e.g. a self-signed certificate — or a timeout is reported as「无法确认占用者」, occupant unknown); for another project's gateway it compares the project id it reports with the working directory of the listening processes and names that project directory (and pid), suggesting `zhin stop` there or a different `http.port`. When the project root still holds service files an older scaffold generated (by the `name` in `package.json`: `<name>.service`, `com.zhinjs.<name>.plist`, `install-service.ps1`, `<name>-task.xml`), the 「旧服务文件」 item says they can be deleted in favour of `zhin service install`; `ecosystem.config.*` is only mentioned when `package.json` has neither a `pm2` dependency nor a `pm2:*` script. The item is informational (not a warning); neither `doctor` nor `--fix` deletes anything.

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

### migrate: Project Upgrade {#migrate}

```bash
zhin migrate [--dry-run] [--no-install] [--include-pinned]
```

Upgrades an older Zhin project to the latest: dependencies, scripts and folder structure. Merged or retired `@zhin.js` packages (see [Merged and retired packages](../migrations/retired-packages.md)) are not upgraded; the retired-packages step lists the `package.json` that declares each one, its replacement, and the imports to rewrite in the project's sources (file and line, e.g. `src/config.ts:2 '@zhin.js/config-yaml' → '@zhin.js/runtime'`; the deleted subpath `@zhin.js/agent/tools` is listed the same way, with `@zhin.js/tool`). `zhin migrate` neither rewrites sources nor removes these dependencies: a retired package may export more than its replacement took over, so rewrite the imports, remove the dependency yourself and run `pnpm install`. The source scan skips hidden directories and dependency or build output directories such as `node_modules`, `dist`, `build`, `out` and `coverage`; `lib` is skipped too, unless the package's `package.json` (`main` / `module` / `exports`) points to a `.js` file in `lib` and it has no `src` directory (a package written in plain JavaScript, whose `lib` is its source). It reads at most 5000 source files and visits at most 20000 directory entries; at a limit both `zhin migrate` and `zhin doctor` say 「仅扫描了前 N 个源文件」 (only the first N source files were scanned). When the check itself fails (an unreadable workspace file, for example) it only prints a warning and the migration goes on. `--dry-run` only prints the plan and ends with "nothing was changed"; `--no-install` skips the final `pnpm install`. Dependencies move to the newest release on the registry your npm configuration points to (mirrors included): ranges become `^x.y.z`, exact versions stay exact, and `@zhin.js/*` entries in `package.json#pnpm.overrides` and in `pnpm-workspace.yaml` `overrides:` are aligned with the dependencies of the target `zhin.js`. Every member package of the pnpm workspace (`pnpm-workspace.yaml` `packages`) gets its Zhin dependencies upgraded too: exact versions move as well (staying exact), local sources (`workspace:`, `link:`, `file:`) are left alone; scripts and engines change only at the root. Exact versions (such as `1.1.6`) are kept unless you pass `--include-pinned`; `npm:` aliases, `link:`, `file:`, git and other non-registry sources are kept even with `--include-pinned` (rewriting them as `^x.y.z` would drop the alias or the source). Full upgrade flow: [Compatibility and migration](../operations/upgrades.md).

In a project directory (one with `zhin.config.*`), `zhin start` needs the CLI and the management gateway in production too, so `zhin migrate` puts `zhin.js`, `@zhin.js/cli` and `@zhin.js/gateway` together in `dependencies`: a package listed only in `devDependencies` moves with its version, a duplicate left in `devDependencies` is removed, and a missing `@zhin.js/gateway` is added (the CLI's dist-tag such as `latest` when it uses one, otherwise the range released together with the running CLI). A `--prod` install therefore keeps everything startup needs. A Plugin package (no project config) keeps the CLI in `devDependencies`. The `zhin runtime migrate` cutover does the same for private (project) packages.

In a pnpm project that declares `@zhin.js/gateway`, `zhin migrate` also adds the gateway's native dependencies `node-pty`, `ssh2` and `cpu-features` to `allowBuilds` in `pnpm-workspace.yaml` (creating the file when missing; existing `true` / `false` values are kept, the `set this to true or false` placeholder pnpm 11 leaves is set to `true`, and an existing `onlyBuiltDependencies` list is appended to), so the install that follows builds them. When the `packageManager` field of `package.json` pins pnpm 10 or earlier and there is an `onlyBuiltDependencies` list pnpm reads (`pnpm-workspace.yaml`, or `package.json#pnpm` of the root project), all three packages (`node-pty`, `ssh2`, `cpu-features`) only go into that list (entries already there are not repeated) and get no `allowBuilds` key, since pnpm 10 builds from the list; in every other case (pnpm 11 pinned, or no pnpm pinned) `allowBuilds` is written as before: pnpm 11 reads only `allowBuilds`, older pnpm ignores the key, and a duplicate allowance is harmless. Only `packageManager` decides whether `allowBuilds` is left out, never the local `pnpm --version`: a deployment or CI may run another pnpm (with pnpm 10 locally and pnpm 11 in CI, leaving the key out would leave the three packages unbuilt). A package the project explicitly keeps from building is added to no allow list (`allowBuilds`, `onlyBuiltDependencies`): listed in `ignoredBuiltDependencies` or `neverBuiltDependencies` (`package.json#pnpm` or `pnpm-workspace.yaml`; for a project inside an enclosing pnpm workspace, the root's two files as well), or set to `false` in `allowBuilds` (versioned keys such as `ssh2@1.16.0: false` included). The plan names the list it found: `已跳过：在 ignoredBuiltDependencies 中` or `已跳过：在 neverBuiltDependencies 中` (skipped: listed in …). A denied package that an allow list also names is left alone in both places with a conflict warning. Non-boolean values other than the `set this to true or false` placeholder (such as `'false'` or `no`) are kept with a warning. `--dry-run` lists exactly what the real run writes. See [Build scripts of the native dependencies](../console/operations.md#native-build).

pnpm 11 does not install releases younger than one day by default (`minimumReleaseAge`), so a fresh Zhin release would stay at the old version (`Already up to date`). `zhin migrate` therefore lists the upgrade targets as `name@version` under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (the form pnpm writes into a new scaffold; entries that already cover a release are not repeated). It writes them only where the gate may apply: the project sets `minimumReleaseAge` above 0, or sets nothing and may use pnpm 11 or newer. The pnpm version comes from the `packageManager` field only: with no pnpm pinned, the project counts as possibly using pnpm 11 even when the local pnpm is 10, since a deployment or CI may run pnpm 11; then only `minimumReleaseAge: 0` in `pnpm-workspace.yaml` keeps the exclusions out. Where the setting is read depends on the pnpm version: pnpm 11 and newer read only `pnpm-workspace.yaml` (pnpm 11 ignores the `pnpm` field of `package.json` and reads only auth, registry, TLS and proxy settings from `.npmrc`, so a `minimumReleaseAge: 0` there does not turn the gate off); with pnpm 10 or earlier pinned in `packageManager`, the project `.npmrc` (`minimum-release-age`) and `package.json#pnpm` are read too. With `0`, or nothing set and pnpm 10 or earlier pinned, nothing is written and one line says why (user-level and global pnpm settings are not read). After the install, it reads `node_modules` to list each package's installed version before and after. When a package did not reach its declared version it exits with an error and the cause (release age, a conflicting `overrides` entry, …). `zhin doctor` also warns, with the fix, when an installed version does not satisfy `package.json`.

`zhin migrate` only creates the directories the current scaffold creates (`data/`, `plugins/`), no longer `src/plugins`; `SOUL.md` / `TOOLS.md` / `AGENTS.md` are only added to a project that uses AI (AI enabled in the config, or `@zhin.js/agent` declared); files still on the old Chinese template are upgraded with a `.bak`.

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

**This is the single official way to create a plugin.** The name must match `/^[a-z][a-z0-9-]*$/`; without arguments it asks interactively. A non-interactive run (CI, scripts, no TTY) never prompts: give both the name and `--type`, or it exits with an error. The normal template's sample commands are `commands/<name>/index.ts` (`<name>`) and its subcommand `commands/<name>/echo/[text]/index.ts` (`<name> echo <text>`).

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

### create: Generate a Convention File {#create}

```bash
zhin create <command|middleware|handler|tool|component> <name> [--cwd <plugin-dir>] [--force] [--event <event>]
```

Writes one capability file into the current plugin package, so you do not hand-write the convention directory or the `package.json#zhin` manifest. The plugin package is the first `package.json` found walking up from the current directory, and it must carry a `zhin.type: "plugin"` manifest (plugins from `zhin new` and bot project roots do); `--cwd` sets another starting point.

| Kind | File | Default export | Feature package |
| --- | --- | --- | --- |
| `command` | `commands/<path>/index.ts` | `defineCommand` (`zhin.js/command`) | `@zhin.js/command` |
| `middleware` | `middlewares/<name>/index.ts` | `defineMiddleware` (`zhin.js/middleware`) | `@zhin.js/middleware` |
| `handler` | `handlers/<path>/index.ts` | `defineHandler` (`zhin.js/handler`) | `@zhin.js/handler` |
| `tool` | `tools/<name>/index.ts` | `defineAgentTool` (`@zhin.js/tool`) | `@zhin.js/tool` |
| `component` | `components/<name>/index.tsx` | `defineComponent` (`zhin.js/component`) | `@zhin.js/component` |

```bash
zhin create command gh/issue                         # commands/gh/issue/index.ts → /gh issue
zhin create command echo/[text]                      # trailing [text] is a required parameter; the template declares params.text
zhin create handler message/receive                  # event inferred from the path: message.receive
zhin create handler welcome --event notice.receive   # use --event when the path is not a built-in event
zhin create tool lookup
```

- Every name segment must match `/^[a-z][a-z0-9-]*$/`. `command` and `handler` names may use `/`; the last segment of a `command` may be a required parameter directory `[name]` (create `[[name]]` / `[...name]` by hand, see [Commands](../authoring/commands.md)).
- Templates are the smallest default export that type-checks; edit them from there.
- `package.json`: when `zhin.features` does not list the feature package, `{ package, api }` is appended; when the plugin does not depend on it yet, it is added to `peerDependencies` (`optional`) and `devDependencies` following the `zhin new` rules, with the range following the plugin's own `zhin.js` spec (`workspace:` stays a workspace link, otherwise the release range `^x.y.z`). Existing entries are never duplicated; other fields and the formatting (2-space indent, trailing newline) are kept. When dependencies change it reminds you to run `pnpm install`.
- An existing target file is an error (exit code 1); `--force` overwrites it.
- `zhin add <package>` is the old spelling of `zhin install` and still works (with a hint to use `zhin install`); create a plugin with `zhin new`.

### install: Install a Plugin

```bash
zhin install <plugin name or git URL> [--no-enable] [--dry-run]
```

By default it installs with pnpm and writes the package reference into `plugins.<instanceKey>` in `zhin.config.yml`. Business settings use the top-level alias block; `disable_plugins` controls activation (change it with [`zhin enable` / `zhin disable`](#enable-disable)). When the plugin schema has required fields without defaults (such as an adapter's `endpoints` accounts), only the dependency is installed, nothing is declared, and the missing fields are printed: fill them in the Console and declare the plugin there (`gateway.plugins.declare`), run `zhin setup --adapters`, or add `plugins.<instanceKey>` and the instance block to the config file yourself and restart.

| Option | Description |
| --- | --- |
| `-D, --save-dev` | Write to `devDependencies` |
| `-g, --global` | Install globally (doesn't enable the plugin) |
| `--no-enable` | Install dependencies only; don't change config |
| `--dry-run` | Print the install and config changes without writing |

While the gateway runs (`zhin start`), the install goes through the gateway's dependency transaction: the instance is stopped, the package manager runs, then the instance starts and must report ready; on failure `package.json`, the lockfile and the config are restored and the old version is started again. Progress is streamed to the terminal. Through the gateway only npm registry packages (`name` or `name@range`) can be installed; git URLs, local paths and `--save-dev` need `zhin stop` first. Without a gateway the install runs directly in the project.

### uninstall: Uninstall

```bash
zhin uninstall plugin <name> [--remove-pkg] [--remove-dir]
zhin uninstall adapter <name> [--remove-pkg]
```

`name` can be an npm package name or an instanceKey; `--remove-pkg` also removes the dependency from `package.json`. When a plugin has a local directory `./plugins/<name>`, `--remove-dir` deletes it without asking (on a terminal too); without the flag a terminal is asked (default: keep) and a non-interactive run (a pipe, CI) keeps it. While `package.json` still depends on that local package (no `--remove-pkg`, or another instance still uses it) the directory is always kept, with a notice, so no dependency is left pointing at a deleted directory. While the gateway runs, the uninstall goes through it (instance stopped and started, rolled back on failure). Remove the system service with `zhin service uninstall`.

### enable / disable: Turn a Plugin Instance On or Off {#enable-disable}

```bash
zhin disable <instanceKey or package>
zhin enable <instanceKey or package>
```

Adds an installed, declared plugin instance to `disable_plugins` in the config file, or removes it from that list. Dependencies and the instance's config block are left alone (use `zhin uninstall plugin` to remove a plugin entirely). The argument is the instance key of `plugins.<instanceKey>`; a package name works only when that package is declared once. With several instances, pass the instance key.

| Situation | Result |
| --- | --- |
| Gateway running (`zhin start`), instance running | Applied in place by a gateway transaction: back up the config → write `disable_plugins` → apply it in the running instance (one new generation: disabling retires all of the instance's commands, middlewares, tools, pages and other capabilities, enabling assembles and commits them). The instance is not restarted and adapters don't log in again; the output says "applied in place, instance not restarted". Needs `plugin.manage`; the local socket counts as the owner |
| When a restart is still needed | If the plugin declares `"restart"` in `package.json#zhin.toggle`, ships a native module, the project's dependencies or lockfile changed after the instance started, the instance is too old, or the in-place apply fails, it falls back to: stop the instance → start it and wait for ready, and the output names the reason. If it fails to start, the config file is restored and the previous instance started again (the package manager never runs) |
| Gateway running, instance not running | Only writes the config; the change applies when the instance next starts |
| No gateway | Writes the config file directly; the change applies at the next `zhin start` |
| Already in the requested state | Exits successfully without changing the config or restarting the instance |
| Undeclared, a reserved key (`http`, `plugins`, …) or the project's root plugin | Error, exit code 1 |
| `enable` when the package isn't installed, its dependencies don't resolve or the instance config fails the plugin schema | Error, exit code 1, config unchanged. `disable` doesn't require the package to still be installed, so you can switch off a broken plugin first |

### update: Update Dependencies

```bash
zhin update [package | package@exact-version ...] [--dry-run]
```

Without package names every dependency is updated (`pnpm update`; in a pnpm workspace `pnpm update -r`, so the workspace members move too). A name without a version must be a dependency the root project or a workspace member declares; otherwise the command fails with 「不是本项目的依赖」 (install it with `zhin install <name>`) and exit code 1, without stopping the instance or changing files. `name@exact-version` of an undeclared package is still installed. While the gateway runs the same transaction goes through it (stop instance → update → start instance, rolled back on failure); otherwise it runs directly.

`--dry-run` only lists what would be upgraded: per root project and workspace member, with the Zhin packages (`zhin.js`, `@zhin.js/*`) first and the rest (`@types/node` and the like) under "other dependencies"; the current → target version with the range from `package.json`, and the newest release when it is outside the range (not installed). Targets come from the registry within each range; nothing is written and the instance is neither stopped nor restarted. pnpm's `minimumReleaseAge` can still hold back a release less than a day old.

Zhin packages declared with an exact version (such as `1.8.0`, `=1.8.0` or `v1.8.0`) in `dependencies` / `devDependencies` are outside what `zhin update` moves; when the registry's `latest` dist-tag (the version `zhin migrate` writes) is newer, the preview ends with a separate list of locked Zhin packages: installed version → latest (`未安装` when not installed, with the locked value noted when the installed version differs). Root locks are upgraded with `zhin migrate --include-pinned` (exact versions stay exact; add `--dry-run` first); a workspace member's lock is shown with the member path and moves with the root on a plain `zhin migrate` (unless the root locks the same package, which then needs `--include-pinned`). Packages decided by an override, packages in `optionalDependencies` (which `zhin migrate` does not upgrade) and `npm:` / `workspace:` specifiers are not listed. When the registry cannot be queried or you are offline, that section is left out without an error.

#### Standard upgrade path {#update-path}

```bash
zhin update --dry-run   # 1. see what moves and how the overrides change
zhin update             # 2. run it (with a gateway: stop instance → update → start instance, rolled back on failure)
zhin doctor             # 3. check that "Zhin 包单实例" (single Zhin package instance) and the rest pass
```

**pnpm overrides**: projects often pin their Zhin packages in `package.json#pnpm.overrides` (or `pnpm-workspace.yaml#overrides`) so that each Zhin package is installed once. When the update touches Zhin packages (no package names, or `zhin.js` / `@zhin.js/*` named), `zhin update` moves those pins to the upgraded versions:

- Before the package manager runs, the Zhin entries it can sync are taken out so the update actually moves those packages; afterwards they are written back from the installed tree — the version the installed `zhin.js` depends on exactly (one release's aligned set), else the project's installed copy — keeping each value's style (`1.2.3`, `^1.2.3`, `~1.2.3`) and the key order, followed by one `pnpm install` so the lockfile matches.
- Supported keys: plain package names (`"@zhin.js/core": "1.12.0"`) and one-level `>` selectors (`"zhin.js>@zhin.js/core": "1.12.0"`).
- Entries for non-Zhin packages and local wiring (`link:`, `file:`, `workspace:`, `$references`) are left alone.
- Forms that cannot be synced automatically (a version selector on the key such as `@zhin.js/core@<2`, a parent with a version selector, several `>` levels, complex ranges such as `>=1 <2`, nested objects) stay as they are, and the update prints `请手动修改 package.json:<line> …` naming the file, line and key to edit.
- The override edits are part of the transaction snapshot: any failure rolls them back together with `package.json` and the lockfile. `--dry-run` lists them in their own "pnpm overrides" group, with each pin's old → new version and the entries to edit by hand.

Updating only other dependencies (e.g. `zhin update @types/node`) leaves the Zhin pins alone.

### search / info: Discover Plugins

```bash
zhin search [keyword] [-c utility|service|game|adapter|admin|ai] [-l 20] [--official]
zhin info <package>
```

Search the plugin marketplace or show one plugin's details. `zhin search` lists only Zhin ecosystem packages (official `@zhin.js/*`, `zhin.js-*` names, or packages with a `zhin.js` / `zhin` / `zhinjs` / `zhin-plugin` / `zhin-package` keyword or a `package.json#zhin` manifest); the generic `plugin` keyword does not count. `zhin info` checks this project's workspace packages and installed packages first (read locally, npm is not queried), then the npm registry. Details include the author (`author`, or `maintainers` when absent); local packages also list their commands, Agent tools and config fields (read statically from the convention directories and `schema.json`; no plugin code runs).

### use-cases: Find a Setup Path by Purpose

```bash
zhin use-cases
zhin use-cases reminder
zhin use-cases personal-reminder
zhin use-cases group-welcome
zhin use-cases keyword-reply
```

Find the required plugin, installation preview, steps and current limitations for reminders, welcome messages and keyword replies. This command only prints a guide: it does not install plugins, change configuration, start the bot or send messages. The existing installation, configuration and chat interfaces still own those operations.

The [Administrator tasks](../paths/console.md#administrator-task-center) tab of Console Operations → Scheduled tasks uses the same catalog. Its first creation flow manages administrator reminders. Welcome messages and keyword replies currently link to existing setup paths; Console does not impersonate a chat member.

### preview: Preview Components and Pages

```bash
zhin preview [dir] [-p 4176] [-H 127.0.0.1] [--open]
zhin preview --export preview.html     # export a single-file static HTML snapshot and exit
zhin preview --json                    # print the scan and render result and exit
```

Starts a local preview workbench: it scans `components/*` and `pages/*` in the project or plugin directory (the current directory by default), hot-reloads, and lets you edit Props and adjust styles live. It listens on `127.0.0.1:4176` by default; `--open` opens the browser after startup.

Sample Props come from `previewProps`; plugin services that a component reads with `use(token)` come from the stand-ins in `previewServices` (see [components](../authoring/middleware-components.md#stand-in-services-for-previews-previewservices)); without one the preview names the missing token.

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
- **Page UI**: checks `pages/**` for deviations from the Console page rules (ADR 0063 rules 1–6: native `<select>`, custom page header, fixed content width, raw style values, off-scale Tailwind classes, native basic controls), each with a suggested replacement. These are **hints** only and count as neither errors nor warnings. Rules and the waiver syntax: [Page UI guidelines](../authoring/console-pages.md#plugin-check-pages).
- Exits with code 1 on errors; `--strict` also fails on warnings (page UI hints excepted); `--json` prints a structured result for CI (page UI under `ui` and `hintCount`).

### pub: Publish a Plugin

```bash
zhin pub [plugin-name|plugin-dir] [--tag latest] [--access public|restricted] [--registry <url>] [--dry-run] [--skip-build] [--skip-check] [--yes]
```

- Inside a standalone plugin from `zhin new --standalone`, run it without arguments to publish the current directory: `npx @zhin.js/cli pub --dry-run` to preview, `npx @zhin.js/cli pub` to publish. (`npx @zhin.js/cli` is reliable with every version; `npx zhin` only means the same CLI from `zhin@4` on, see the tip at the top of this page.)
- The argument can also be any plugin directory (its `package.json` has a `zhin` field), e.g. `zhin pub ../my-plugin`.
- In a bot project root, the argument is a path relative to `plugins/`; without it a single plugin is picked automatically, several are offered interactively.
- `--dry-run` goes through the flow without publishing. Non-interactive shells (CI) need `--yes` to skip the publish confirmation. Packages with `private: true` are rejected, and a `zhin.entry` pointing at `.ts` gets a hint to publish the built `.js`.
- Without `--access`, the package's `publishConfig.access` applies, and `public` when it has none; a private package with `"publishConfig": { "access": "restricted" }` is never published publicly by accident, see [Private plugin packages](../authoring/plugin-delivery.md#private-packages).
- Before publishing it runs [`zhin plugin check`](#plugin-check-check-a-plugin-before-publishing) automatically (`npm pack` included). Errors stop the publish; warnings alone let it continue. Use `--skip-check` to skip it if you really must.
- Full release flow: [Complete plugin delivery](../authoring/plugin-delivery.md).

### packages: Plugin Status and Extension Packages

**Manage skill / extension packages** (ADR 0010):

```bash
zhin packages install <npm:skill-pack|git:url> [--local]
zhin packages remove <name> [--local]
zhin packages list [--local] [--json]
zhin packages update [source] [--local]
```

`--local` (`-l`) installs into the project's `.zhin/packages/` instead of globally.

`zhin packages list` groups the dependencies in the project's `package.json` (run from a subdirectory, it finds the project root above): adapters, plugins, the Zhin framework and feature packages (`zhin.js`, `@zhin.js/core` and packages whose `package.json#zhin.type` is `feature`; the first two declare `plugin` but the runtime treats them as the platform itself, not as the project's plugins), other dependencies, declared but not installed, and finally the skill packs; `--json` prints `{ packages, skillPacks }`. The group comes from the installed package's `package.json#zhin`, as on the Console plugins page.

For npm plugins use `zhin install` / `zhin search` / `zhin info` ([ADR 0062](../../adr/0062-one-path-per-task.md) item 11). `zhin packages install <npm package>`, `zhin packages search` and `zhin packages info` still work unchanged but warn that they are deprecated and will be removed in a later release.

**Check whether a plugin is really live**: installing doesn't mean it's loaded, its platform is online, or its features are verified. Use these to inspect status and run verification:

```bash
zhin packages status <instanceKey>                       # reads the running instance through this project's gateway
zhin packages status <instanceKey> --live http://127.0.0.1:8068
zhin packages verification-plan <instanceKey>            # --json for the raw structure
zhin packages apply <instanceKey> --project-revision <revision>
zhin packages verify <instanceKey> <check-id> \
  --generation <generation> --project-revision <revision> --check-revision <checkRevision>
```

Without `--live`, these four commands go through this project's gateway over its local socket (`.zhin/gateway.sock`) to the instance it supervises, which answers from its current generation; no Console token is needed. `--live <host-url>` connects to that Host instead. When the gateway isn't running or the instance doesn't answer, `status` / `verification-plan` check only the local files and say why, and `apply` / `verify` refuse.

States returned by `status`:

| State | Meaning |
| --- | --- |
| `installed` | The package resolves |
| `declared` | An instance is declared |
| `missing-config` | Required config or environment variables are missing, or values don't match the schema |
| `pending-restart` | The running version hasn't applied it yet |
| `unknown` | No running-instance state was available (gateway not running, instance not answering or not yet reporting a generation), so whether it's live can't be told; `statusReason` says why |
| `enabled` | Live, with config and package version consistent |
| `degraded` | Declaration and actual installation disagree, or a dependency check failed |

`readiness` records readiness evidence separately (`unknown` when an adapter is present but there's no platform health evidence); `verification` only says whether business checks exist — **a successful start is not a business pass**.

::: details Live requests, verification flow and concurrency rules
- **Token**: live requests read the Console token from `ZHIN_CONSOLE_TOKEN`, or the variable named by `--token-env <name>`. `verification-plan`, `apply` and `verify` need full permissions. Never put tokens in URLs or command arguments.
- **HTTPS**: remote requests carrying a token must use HTTPS; plain HTTP is allowed only for `localhost`, `127.0.0.0/8` and `::1`.
- **Offline mode**: offline `status` provides only file and package-resolution evidence, and a declared, enabled plugin reports `unknown` (not `pending-restart`); an offline verification plan has no current version or runnable checks, and never starts the Runtime.
- **Verification steps**: review the scope and side effects in `verification-plan` first, then pass the returned `generation`, `projectRevision` and `checkRevision` to `verify`. Changes to config, version or check definitions reject old plans. Plugins without checks return `not-configured`; passing local checks doesn't mean platform delivery is verified. `apply` only requests application — confirm with a live `status` afterwards.
- **Schema**: a loaded config schema applies only to the same package version; after an update the on-disk `schema.json` is read. If the new version declares config only in TypeScript with no readable schema, `validation.schemaAvailable` is `false` and only environment references are checked; full validation needs a real Runtime pre-check.
- **Production dependencies**: auto-enabled plugins must be production dependencies; `--save-dev` must be combined with `--no-enable`, and this is checked before installing.
- **Concurrency**: project changes use a file lock and revision checks. Concurrent operations or config drift fail explicitly; if install steps already completed, partial-completion evidence is returned and user changes are never overwritten. If the lock's owning process has exited, the error shows the lock path — delete it after confirming no installer is running, then retry.
:::

## Working with a running bot

These commands work on a running bot, so start it with `zhin start` in the project directory first. By default they only use **this project's gateway** over its local control socket (`.zhin/gateway.sock`), as the local owner, without a token; when this project's gateway is not running they fail with "本项目的网关未运行" and never connect to the local `http.port` (another project's gateway may be listening there). To reach another address pass `--host <url>`: requests then carry the Console API token from `ZHIN_CONSOLE_TOKEN` (issued in your Console account settings, never more than your own permissions; after Console setup `http.token` is always refused), and a loopback address is first checked against the project id its `/pub/health` reports — a different project is refused, and so is a target that reports no project id (an older gateway or a `--standalone` instance) unless you pass `--allow-unverified-host`.

"This machine" covers loopback (`127.0.0.1`, `localhost`, `[::1]`, `0.0.0.0`), `*.localhost`, the machine's interface addresses, and host names that resolve to them (one DNS lookup of at most 1.5 seconds, only for the project check; a failure or timeout counts as not local). Over plain HTTP a token only goes to loopback: `*.localhost` does not count (Node resolves it through the system resolver, which a DNS server could point elsewhere), and a resolved address never allows a plain-HTTP token (the request resolves the name again, and DNS may have changed). `zhin chat-roles export|import` accept `--host` and `--allow-unverified-host` as well.

### send: Send a Message to a Running Bot

```bash
zhin send <scene_id> [content...] [-s private|group|channel] [-a <adapter>] [-e <endpoint>] [--host <url>]
```

`scene_id` is a user ID for DMs or a group number for groups; without `content` it reads one line from stdin. `-a` may be omitted only when the instance has a single adapter; `-e` picks an account ID, defaulting to the adapter's first online account.

A failed send shows the reason (for example no open Sandbox session, an account that is not connected, or a platform refusal). An internal instance error shows only "Internal error"; with `--debug` the CLI shows its log correlation id and finds that line in the last 1000 lines of `zhin logs`.

### watch: Monitor a Running Instance

```bash
zhin watch [-i 3] [--once] [--json] [--no-clear] [--host <url>]
```

Refreshes a status panel in the terminal (stats, accounts, assistant jobs). `--once` fetches once and exits; `--json` suits scripts.

### schedule: Persistent Scheduled Tasks

Have the AI run a prompt at given times. The command talks to the running instance through the Host API and takes effect immediately; the bot must be started with `zhin start` and have `assistant.enabled`.

```bash
zhin schedule list [--json] [--host <url>]
zhin schedule add "0 0 9 * * *" --prompt "Good morning, summarize today's schedule" [--kind solar|lunar|workday|freeDay]
zhin schedule add --every 30m --prompt "Check RSS"
zhin schedule add --at <iso8601> --prompt "One-off reminder"   # within the next 365 days, e.g. tomorrow 09:00 as ISO8601
zhin schedule add "0 0 8 * * *" --prompt "Compile today's briefing" --agent news
zhin schedule set-agent <id> <agent>     # change the Agent a job runs on
zhin schedule set-agent <id> --clear     # back to the default Agent (zhin)
zhin schedule update <id> --cron "0 0 8 * * *"   # change the time, keep everything else
zhin schedule update <id> [--kind <kind>] [--at <iso8601> | --every <interval>] [--label <label>] [--enable | --disable]
zhin schedule remove <id>
zhin schedule pause <id>
zhin schedule resume <id>
```

| `add` option | Description |
| --- | --- |
| `--prompt` | Required: the prompt sent to the AI when due |
| `-l, --label` | Job name |
| `--kind` | `solar` (default, Gregorian) / `lunar` / `workday` / `freeDay` |
| `--notify-channel` | `im` / `silent` (default; `im` when `--target` is given) / `log` |
| `--target` | IM delivery target `<adapter>:<endpoint>:<kind>:<id>` (`kind`: `private` / `group` / `channel`), e.g. `sandbox:sandbox-bot:private:u1`; defaults to `assistant.defaults.notify` or the profile's `defaults.notify`. Without a usable target, or when its account does not exist, the instance refuses the job and says why. An explicit target also needs `endpoint.operate` on that account (as `zhin send` / `/message/send` does; the Console `cron:add` RPC too), otherwise 403 `schedule_target_forbidden` |
| `--agent` | The Agent that runs the job, by its `ai.agents` name (e.g. `ai.agents.news`); without it the job runs on the default Agent `zhin`, as before. An unknown name is refused (400 `schedule_agent_not_found`) with the list of available Agents |
| cron expression, `--at`, `--every` | Pick one: a six-field cron (sec min hour day month weekday), a one-off ISO8601 time, or an interval (e.g. `30m`, `1h`, `1d`). `--at` must be in the future and at most 365 days ahead (the same bound as the Agent's schedule tools); a later time is refused locally by the CLI without a request, and a direct `POST /api/assistant/jobs` / `jobs/update` gets 400 `invalid_argument` from the instance. An `--every` interval runs from 1 second to 365 days (the same bound as `--at`); a longer one is refused locally the same way, and the instance answers a direct request with 400 `invalid_argument` |

To move an existing job to another Agent, run `zhin schedule set-agent <id> <agent>`; `--clear` restores the default Agent. No need to stop the bot and edit the database. The name is checked against `ai.agents` the same way; heartbeat jobs always run on the default Agent and cannot be changed; profile routines are refused (they are re-declared from the profile on every start: set the routine's `agent` field in `assistant.profile.yml`); a job with a delivery target needs `endpoint.operate` on that account, else 403. `zhin schedule list` flags a job whose Agent was removed from `ai.agents` with "⚠ Agent 不存在". The change applies from the next run. Both commands need `ops.schedule.write` (through `POST /api/assistant/jobs` and `POST /api/assistant/jobs/set-agent`; in the Console, the `agent` field of `cron:add` and `cron:set-agent`).

To change the time, label or enabled state of an existing job, use `zhin schedule update <id>` instead of removing and re-creating it (re-creating loses the job's Agent, delivery target, creator and execution plan). `--cron` (or the positional argument) sets a new cron and keeps the job's schedule kind unless `--kind` is given; `--kind` alone keeps the cron; `--at` / `--every` turn it into a one-off or interval job (pick one of the three); `--label` sets the label, `--label ""` clears it; `--enable` / `--disable` switch it on or off. The Agent, prompt, delivery target and creator stay as they are, and the next run is recomputed from the new schedule. At least one change is required, otherwise nothing is sent and the CLI exits non-zero. It goes through `POST /api/assistant/jobs/update` and needs `ops.schedule.write`; when the job keeps running and has an IM delivery target it also needs `endpoint.operate` on that account, as `resume` / `set-agent` do: changing the time, the label or enabling it all need it, only `--disable` does not, and the CLI's refusal hint says so. Profile routines are refused (400 `schedule_update_profile`; change `assistant.profile.yml`). The matching chat tool is `schedule_update`.

`--kind` takes `solar`, `lunar`, `workday`, `freeDay` or `holiday`, case-insensitively. The instance builds and checks the schedule with the same rules as `schedule_update`: `workday`, `freeDay` and `holiday` take only the time of day from the cron (the day, month and weekday fields become `*`; `--cron "0 0 9 * * 1-5"` is stored as `0 0 9 * * *`). A malformed cron (wrong field count or an out-of-range value, such as `0 0 9 32 * *`) is a 400 `schedule_invalid`: the job is unchanged, and the CLI says why and exits non-zero. A well-formed cron that never comes due for the kind (such as `0 0 9 30 2 *`) is not an error: `update` saves it and adds a `warning` to the response, `add` saves it as is. **To change a `workday` job back to `solar`, give the full cron as well**, e.g. `zhin schedule update <id> --kind solar --cron "0 0 9 * * 1-5"`: `--kind solar` alone keeps `0 0 9 * * *` and runs every day; the original Monday to Friday is not restored. When the saved job is enabled but has no computable next run, the response carries a `warning`, which the CLI prints. The `--kind` of `zhin schedule add` is case-insensitive too, accepts `holiday`, and is checked by the same rules.

`zhin schedule resume` (`POST /api/assistant/jobs/resume`, the Console's `cron:resume`) makes the job deliver to its target again, so, as for `add` / `set-agent`, a job with an IM delivery target requires `endpoint.operate` on that account, else 403 `schedule_target_forbidden` (Console RPC: in `data.code` / `data.status`); `pause` / `remove` only stop deliveries and still need just `ops.schedule.write`. When refused, the CLI exits non-zero and says why, e.g. "无法恢复任务 `<id>`：你没有权限向它的投递目标发消息（需要 `<adapter>` / `<endpoint>` 上的 endpoint.operate）" (you may not send to the job's delivery target), and suggests asking an administrator for the grant, or removing the job and re-creating it with a target you may send to. On `schedule_agent_not_found`, `add` / `set-agent` list the available Agents the instance returned (`data.available`) and suggest picking one with `--agent` or `zhin schedule set-agent <id> <name>`; when there are none they point to adding one under `ai.agents`.

`zhin schedule list` shows the Agent of each job ("zhin（默认）" when none is set), each job's resolved delivery target (account name + conversation) and the next run of enabled jobs; a target whose account no longer exists, or a missing target, is flagged "⚠ 无效" (invalid), and an enabled job without a next run is flagged "⚠ 无（不会触发）" (it also appears under the Console's attention list). Multi-line content is indented line by line and cut after 2 lines; `--json` prints the full job data.

### agent: Agent Diagnostics

Requires the AI stack (`@zhin.js/agent` + `zod` + `ai`).

```bash
zhin agent info [--json] [--locale zh-CN|en]
```

| Command | Purpose |
| --- | --- |
| `info` | Lists Agent capabilities and named Agents (tools, skills, hooks…) by source: the **project root**'s convention directories (`tools/`, `skills/`, `agents/*/tools` …, i.e. the application plugin itself), **local plugins** (`plugins/`) and **installed plugins** (`node_modules` packages with a `package.json#zhin` manifest). Below the totals line it gives the packages, tools and skills of each source; `--json` has the same grouping as `bySource`. Framework built-in tools and MCP tools are not project files and are not counted — `zhin trace` shows the tools available at run time |

The output language is the project's `locale` (top level of `zhin.config.yml`, Chinese by default); `--locale` overrides it once. Help texts are bilingual.

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
| `-l, --list` | One line per turn: time, end status, turn id, session, tool count, tokens. The session is shown by the same readable name as `zhin usage report` plus a short key (e.g. `sandbox · 私聊 Developer（personal-session:ab12cd34）`), or the short key when no origin was recorded; `--json` keeps the full `session_key` and adds `session_display_name` |
| `--sessions` | One line per session: the chat's name (the `zhin usage report` format: `platform · 私聊/群 name` plus the short key, e.g. `sandbox · 私聊 Developer（personal-session:ab12cd34）`), turn count, last time and status, total tokens; when a session's turns came from several chats, each chat (up to 10) is listed indented below it (only IM conversations, scheduled jobs and internal sources are told apart; a session's A2A, MCP and HTTP turns form one entry each). Control characters, line breaks and bidi controls in names are escaped as `\uXXXX` before printing. Older traces without a recorded origin show the full session key; `--json` prints the summary's `origin`, `platform`, `scope_kind`, `scene_label`, `display_name` and `conversations` fields (see below) |
| `--engagements` | Read multi-Agent collaboration records instead (the `engagement_events` database table; requires SQLite, MySQL, or PostgreSQL): with `--list`, list recent collaborations; otherwise show the participants, mail hops, Blackboard, and budget of the latest or the given collaboration. See [Multi-Agent Collaboration and Venues](../ai/multi-agent-harness.md) |
| `-s, --session <key>` | Only this session (sessionKey); output switches to the list format |
| `--since <time>` / `--until <time>` | Time range (`--until` exclusive): `30m`, `2h`, `7d` (how long ago), an ISO date/time, or epoch ms |
| `-n, --limit <n>` | Show at most the latest n entries, default 50 |
| `--json` | Raw JSON output (snake_case fields) |
| `--no-timeline` | Do not print the step-by-step timeline |
| `--cwd <dir>` | Project root, default current directory |
| `--dir <dir>` | Read a trace directory directly (a failed eval report prints this argument) |

A trace contains: the initiator and role, the session, tokens for each model call, each tool call (argument summary, duration, result size, error or refusing policy), budget extensions and automatic continuation, nested sub-agent turns, per-segment context cost, and the end reason. The output starts by calling out the **first failing step**.

**Triggering message.** Since #1250 a trace also records the message that started the turn: a text excerpt (whitespace collapsed, credentials redacted, cut to 120 characters), the sender id and sender name, the conversation (adapter, Endpoint, conversation kind and id), the message id, and when it was received, how long it waited and queued, and how many messages were merged. A trace file therefore holds fragments of what users said plus their identifiers: anyone who can read `data/agent-traces`, anyone who can run `zhin trace`, and Console accounts or API tokens holding `agent.view` (`/api/agent/traces`, `/api/agent/trace-archive/*`) can see them. Shorten `ZHIN_TRACE_RETENTION_DAYS` if you do not want to keep them.

**Inbound media.** When the turn carries media, the trace's `media` records each item's outcome and reason code; an item the perception pre-pass described names the service / model used, whether it was a cache hit, and keeps the description (credentials scrubbed, terminal control characters removed, up to 4000 characters; longer text is marked as truncated with its full length). The perception request itself counts as a model call, marked "（识图）" in the call list. A call whose provider reported no usage (a failed or cancelled perception request, or a success without usage) only has an estimate: the call list and the timeline print its input / output as `?` (as `[ai.usage]` does), and the totals are marked "（含估算）" (includes estimates).

Model calls of sub-agents (collaborating agents reached by `ask` / `delegate`) are recorded in their nested turns. The parent's "model calls / tokens" line shows the total with a split ("self N, sub-agents M"), and the trace field `subagent_usage` holds the sub-agent part; `ai.usage` logs and usage statistics count every call once. The timeline, `requests` and `model_calls` record one provider for one request (the service actually resolved), shown as the service name (`service · model`), or the model alone when the service configuration cannot be read.

**Retention and redaction.** Traces are kept for 7 days with a 64 MB total cap by default: cleanup runs at startup and every hour after that, first deleting expired date files and then deleting from the oldest day until the total is under the cap (today's file is never deleted for size). Adjust with the `ZHIN_TRACE_RETENTION_DAYS` and `ZHIN_TRACE_MAX_MB` environment variables. A trace stores summaries only: tool results record only their length, not their content; tokens, passwords, `Authorization`, and similar fields in arguments and error messages are replaced with `[redacted]`, and before writing to disk inline credentials (`sk-…`, `Bearer …`, and so on) and secret values from environment variables are scanned once more. The legacy `data/agent-traces/recent.json` is still read.

**Console page.** The "Agent Trace" page in Console (`/console/agent-trace`) reads the same data: session list → turn list → turn detail (model/tool call waterfall, timeline, and raw record), with time filtering, and `?turn=<turnId>` opens a turn directly. Add one page to your project to enable it:

```tsx
// pages/agent-trace/index.tsx
import { TraceArchivePage } from '@zhin.js/client';
import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({ title: 'Agent Trace', icon: 'Activity', order: 31 });
export default TraceArchivePage;
```

Behind the page are the read-only endpoints `GET /api/agent/trace-archive/sessions`, `/turns?sessionKey=&since=&until=&limit=`, and `/turn?turnId=`. They require `agent.view`; an account or API token without it gets 403. The session list names a scheduled job's session after the job's `label` — on purpose: `agent.view` already shows that job's turns in full (prompt, replies, tool calls), so the name reveals nothing more, and `ops:schedule:read` is not required on top.

Besides `session_key`, `turns`, `first_started_at`, `last_started_at`, `last_status` and `total_tokens`, a session summary (each item of `/sessions`, and the output of `zhin trace --sessions --json`) carries, since #1250 (all optional; absent for older traces without a recorded origin):

- `origin`: the origin of the latest turn that recorded one, in the same shape as a turn's `origin` (for `kind: 'im'`: `platform`, `endpoint`, `scope`, `sceneId`, `conversation`, …, which may hold raw user ids; the same information `/turns` returns, under the same `agent.view` permission).
- `platform`, `scope_kind`, `scene_label`, `display_name`: the parts of a readable name. `platform` is the IM platform; `scope_kind` is `private` / `group` / `channel`, or `schedule` / `http` / `a2a` / `mcp` / `internal` for other origins; `scene_label` is the group / channel name or the private peer's display name, else the raw conversation id; for a scheduled job's session it is the job's `label` while the instance still knows the job, else the job id; `display_name` is a pre-built Chinese label in the same format as the usage stats' `bySession[].displayName` (the one the Console usage page shows): `sandbox · 私聊 Developer`, `sandbox · 群 开发群`, `定时任务 每日早报`, `HTTP`. A Console should build the label from `scope_kind` + `scene_label` in its own language; account names are matched by `origin.platform` / `origin.endpoint`.
- `conversations`: only when the session's turns came from more than one chat — each chat as `{ origin, turns, last_started_at }` plus the same `platform` / `scope_kind` / `scene_label` / `display_name`, most recent first, at most 10; `conversations_total` gives the number of chats when there were more.

Group names are recorded in traces from this release on (`origin.conversation.name`, at most 128 code points); older traces can only show the group id. Platform-given names (group names, the requester's display name) are cleaned when recorded and when labelled: trimmed, control characters (ESC sequences and line breaks included), U+2028 / U+2029 and bidi controls (U+202A–202E, U+2066–2069) escaped as `\uXXXX`, then cut to 128 code points (never inside a surrogate pair); a session summary cleans older traces' `origin.conversation.name` the same way.

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
| `--tz <zone>` | IANA zone for day boundaries; defaults to the instance zone (`TZ`, else the system zone) |

Each day also lists model usage merged by "service · model": calls recorded under a service's `services:` and `accounts:` ids become one row, with the service name read from the model configuration in the project database (the model alone when it cannot be read). The session column shows the conversation name recorded in the trace (e.g. `qq · 群 Test`) with a short session key. Input tokens are the provider-reported input of every model call (iterations and sub-agents included), a different basis from the first-request segment estimate below.

Per day: turns, model calls, calls per turn and per-call input tokens (p50 / p90 / max), cache-read share (`cache_read_tokens` / `prompt_tokens`), history / fixed / user prompt shares, turns that hit the iteration limit, and the top 5 sessions by input tokens. Segment shares come from each turn's first-request estimate (`context_budget`); fixed = system + tool_schemas + output_schema + tool_index + skill_catalog + agent_catalog + knowledge_index + memory + bootstrap. "Hit the iteration limit" means a `last_iteration_nudge` was recorded or the turn ended `budget_exceeded`.

**Prompt-cache hint.** Every model call records a request-prefix hash (system prompt + tool definitions, trace field `prefix_hash`). When a service's last 20 or more consecutive calls, across at least 3 sessions, had no cache read (`cache_read_tokens` 0 or not reported) while more than half of the adjacent same-session requests shared their prefix, the report ends with "this service may not support or pass through prompt caching" and shows the same-prefix share as evidence. `zhin doctor` runs the same check over the last 7 days of traces, and the Console usage statistics carry it too (`promptCacheHints` of the `usage-stats` RPC).

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
