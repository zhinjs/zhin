---
title: "Operations: Instance, Dependencies and Terminal"
description: The Console Operations group - instance status, start / stop and logs, dependency installs and rollback, database / configuration / environment / schedules / files, and terminal safety
---

# Operations: Instance, Dependencies and Terminal

The **Operations** group in the sidebar answers "how is the host doing". The instance page, dependency installs and the terminal are served by the management gateway ([ADR 0054](../../adr/0054-management-gateway.md)) and **keep working while the instance crashes, stops or installs dependencies**; the database, configuration and schedule pages read from the instance or the project files. By default only `owner` / `admin` see this group (`operator` has only `ops.schedule.read`).

| Page | Route | Read | Write |
| --- | --- | --- | --- |
| Instance (with project dependencies) | `/ops/instance` | `status.view`; dependency list `feature.view` | Start / stop `ops.restart`; dependencies `plugin.manage` |
| Database | `/ops/database` | `ops.database.read` (browse, sort, filter, table structure) | records `ops.database.write`; SQL console and schema `ops.database.schema` |
| Configuration file | `/ops/config` | `ops.config.read` | `ops.config.write` |
| Environment variables | `/ops/env` | `ops.env.read` | `ops.env.write` |
| Scheduled tasks | `/ops/schedules` | `ops.schedule.read` | `ops.schedule.write` |
| Project files | `/ops/files` | `ops.files.read` | `ops.files.write` |
| Terminal | `/ops/terminal` | `ops.terminal` (`owner` only) | — |

Plugins are installed, updated and uninstalled from the **Plugins** group in the sidebar (**Plugins** `/plugins`, **Plugin store** `/marketplace`, plugin details `/plugins/:name`); that needs `plugin.manage` and runs through the same [dependency transaction](#packages) described below.

## Instance {#instance}

The **Instance** page is **the single detail page for runtime status**: Home and Bot status only summarize it, and the full state of the process and instance is here. The gateway keeps serving this page while the instance is offline; when the **Instance unavailable** banner appears, **View instance** brings you here (see [When the instance is offline](./index.md#instance-offline)).

- **Runtime status**: `stopped`, `starting`, `running`, `stopping`, `backoff` (waiting to restart after a crash), `crashed` (more than 10 restarts within a minute; it stays crashed until someone acts), with process PID, uptime, restarts in the last minute, start time, generation (`generation`), last exit and instance ID. While a dependency transaction runs, the transaction stops and starts the instance.
- **Last failure**: time, exit code and **Logs before the failure**. Find the cause in the logs (often: a dependency not installed, a required setting missing, an empty environment variable), fix it, then click **Start**; dependency problems can be fixed by reinstalling under **Project dependencies**.
- **Actions**: start, stop, restart (`gateway.instance.start|stop|restart`, need `ops.restart`, confirmed first). After a stop the bot is offline until started again; a restart takes it offline briefly and may interrupt ongoing conversations. A restart affects only the instance; the gateway and Console stay up. Until the instance is `running` again, pages that depend on it return `503 instance_unavailable`, and the banner counts down and retries automatically.
- **Instance logs**: the instance's standard output and standard error collected by the gateway (`gateway.instance.logs`, needs `status.view`), readable while the instance is offline; show only error output, pause, or follow the latest. The full log is `.zhin/logs/instance.log` on the server.
- **Project dependencies**: the dependencies declared in `package.json`, their declared and installed versions. **Install dependencies** takes several packages (`name@range`, separated by spaces or commas) and can enable the plugin in the configuration after installing; each row has **Update** and **Uninstall**, and **Update all** updates everything. Packages outside the allowlist can only be installed by owners.

The command-line equivalents are `zhin status` and `zhin logs`, see [zhin start](../cli/runtime.md).

### Dependency installs and rollback {#packages}

Every way of installing, updating and uninstalling plugins and dependencies goes through the gateway's dependency transaction (`gateway.packages.plan|install|uninstall|update`, need `plugin.manage`): **Install** in the plugin store details, **Update** / **Uninstall** under **Version and dependencies** in plugin details, **Project dependencies** on the Instance page, and onboarding step 4.

1. Build a plan, check the allowlist and configuration revision, back up `package.json`, the lockfile and the configuration; the page shows the plan and runs it only after you confirm;
2. stop the instance;
3. run the project's package manager, streaming its output to the Console (`gateway.packages.progress` on the event stream);
4. start the instance and wait until it is ready (60 seconds by default);
5. on any failure: restore the backup, reinstall, start the old version, and report the failed stage and log tail.

Plugin configuration schemas are only validated once the instance has started; a validation failure counts as a step 4 failure and is rolled back. When a plugin schema has required fields without defaults, the install result shows **Needs configuration** with the missing settings and environment variables; its button opens a form generated from the schema, and on submit the gateway writes the plugin declaration and restarts the instance, rolling the configuration back on failure.

If an install receipt is lost (outcome unknown), the page only checks the current state read-only and never replays the old operation; see [action receipts](./index.md#receipts).

## Database, configuration, environment, schedules, files {#ops-pages}

- **Database**: browse tables, query with conditions, edit rows and the KV store; the SQL console and schema changes are [below](#database). Writes hit the project database directly; there is no undo.
- **Configuration file**: view and edit `zhin.config.yml` in its current YAML / JSON format; saves carry the revision and roll back on failure. While the instance is offline the gateway reads and writes it. A plugin's settings are edited as a form on its global settings page (`/features/global/:plugin`); per-level overrides are in the Features tab of the object pages.
- **Environment variables**: the `.env` file. It may contain secrets, which is why `viewer` lacks `ops.env.read`.
- **Scheduled tasks**: opens on the **All tasks** overview, summarizing each task's status, next run, latest result, target and approval, filterable by status; creating, pausing and reading history happen in their own tabs: **Administrator tasks** (`?tab=admin`, create administrator tasks by use case), **Scheduled reminders** (`?tab=schedule`, plugin-registered and persisted tasks), **Assistant tasks** (`?tab=assistant`) and **Execution history** (`?tab=history`).
- **Project files**: the project file tree and text editing; reading or writing `.env` and the configuration file still needs `ops.env.*` / `ops.config.*`.

### Database {#database}

The **Database** page browses tables: server-side sorting and filtering (filters accept only columns of the table and `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$like`, `$nlike`, `$in`, `$nin`), the table structure and previews of schema changes need `ops.database.read`; editing rows needs `ops.database.write`.

The **SQL console** (read-only queries and write SQL) and **schema changes** need `ops.database.schema`, which only `owner` has among the built-in roles. Read-only SQL is not open to `viewer` / `admin` either: deciding from the text whether a statement "only reads" cannot be a security boundary (escaped spellings and dynamic-SQL functions get around it), so accounts without the permission keep the structured browser above; the Console hides the SQL tab and says why.

**Prerequisites of the SQL console** ([ADR 0059](../../adr/0059-gateway-storage-isolation.md), Chinese): Console accounts are not in the project database (they are in the gateway's `.zhin/gateway.db`), so no SQL typed here can read them — storage and the database account hold that boundary; the text checks below are defense in depth:

- **SQLite**: nothing to set up. The instance connection refuses `ATTACH`; attaching another file is refused and its transaction rolled back (capability `sqlIsolation: 'separate-store'`). In-memory databases are unavailable (see below).
- **PostgreSQL / MySQL**: the SQL console runs only on a separately logged-in restricted account (`sqlIsolation: 'restricted-credential'`). Without `database.console`, or when the start-up privilege probe fails, the SQL tab shows the reason and cannot run (data browsing and schema changes still work). Create it with `zhin db console-role` (`--print-sql` for a DBA, or `zhin doctor --fix`), then `zhin restart`; see [configuration: `database.console`](../configuration/index.md#database-console).
- **No DDL in the PostgreSQL SQL console**: the restricted account owns no table and cannot create objects in `public`, so `CREATE` / `ALTER` / `DROP` answer 42501 (insufficient privilege) and the Console points to the schema editor. The MySQL account may create, alter and drop tables of its database, but has no triggers, routines, events, `FILE` or any global privilege, and the client refuses `LOAD DATA LOCAL`.

Limits of the SQL console (they apply to `owner` too):

- Every statement runs through a single-statement protocol (PostgreSQL extended query protocol, MySQL prepared statements, SQLite `prepare`), so the server never runs a second statement hidden in one; transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `SET`, …), `PREPARE` / `EXECUTE`, defining functions / procedures / rules / extensions and changing roles or server settings are refused, so a dry run always rolls back.
- Read-only queries run in a read-only transaction, return at most 1000 rows (PostgreSQL through a cursor, MySQL streamed, SQLite row by row — only the kept rows are read) and time out after 10 seconds (PostgreSQL `SET LOCAL statement_timeout`, which `set_config` cannot lift; MySQL `max_execution_time`). On a SQLite file database a read runs on its own read-only connection in a child process that is killed at the time limit, so it never blocks the instance; an in-memory database cannot be isolated that way, so the SQL console is unavailable there. When the server reads strings differently from the default (PostgreSQL `standard_conforming_strings = off`, MySQL `sql_mode` with `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`), the SQL console is off and says why.
- (Defense in depth) `console_*` table names of the gateway are refused for everyone: names and literals are compared unquoted with escapes resolved; PostgreSQL `U&"…"` spellings, dynamic-SQL and file functions (`query_to_xml` and the other `*_to_xml*`, `xpath`, `ts_stat`, `dblink*`, `lo_*`, `pg_read_*`, `pg_ls_*`, `set_config`, …) and MySQL executable comments `/*! … */` and optimizer hints `/*+ … */` are refused. Table lists and table structure leave `console_*` out; system catalogs such as `sqlite_master` and `information_schema` stay queryable and show the names and columns of `console_*` tables (not their data) — an accepted limit; statistics views that hold real values (`pg_stats`, `pg_stats_ext*`, `pg_statistic*`, `sqlite_stat*`, MySQL `column_statistics`) and role password hashes (`pg_authid`, `pg_shadow`, MySQL `mysql.*`) are refused.
- Bulk or cascading destruction that name-based protection cannot see is refused: `DROP OWNED`, `REASSIGN OWNED`, creating / altering / dropping databases and schemas, `DROP … CASCADE`, `TRUNCATE … CASCADE`, `ALTER … OWNER TO`, tablespaces, users and roles, MySQL `RESTART` / `CLONE` / `PURGE` and the like; triggers and events cannot be created here either.
- Tables declared by code (a plugin's `define`) cannot have columns dropped or renamed here: the plugin reads them and adds them back at its next start, so change the plugin's table definition instead. On MySQL a column change restates the column with `MODIFY COLUMN`; everything the change does not touch (full type, character set and collation, `ON UPDATE`, `AUTO_INCREMENT`, comment, expression defaults) is taken from `information_schema`.
- The audit log records the SQL text and schema changes (including the DDL a failed change attempted) with string literals replaced by `'…'` and comments removed; result rows are never recorded.

## Terminal {#terminal}

The terminal opens a host shell in the browser, or jumps to an allowlisted SSH target ([ADR 0051](../../adr/0051-console-terminal.md)). It runs in the gateway, so it works while the instance is crashed.

::: danger The terminal is a host shell
The terminal runs arbitrary commands as the system user running the gateway and can read and write everything that user can (including `.env`, the database and private keys). **Holding owner credentials is holding a shell on this machine.** Enable it only when needed, give owner accounts strong passwords, and do not issue long-lived API tokens with `ops.terminal`.
:::

### Enabling

Off by default; when off, no terminal routes are registered (404):

```yaml
console:
  terminal:
    enabled: true
    shell: /bin/bash        # default: $SHELL, powershell.exe on Windows
    cwd: .                  # relative to the project root
    idleTimeout: 900        # seconds without input before disconnecting
    maxSessions: 4          # concurrent sessions
    ssh:
      - name: build-box
        host: 10.0.0.12
        port: 22
        username: deploy
        privateKeyPath: ~/.ssh/id_ed25519     # or privateKeyEnv / passwordEnv (+ passphraseEnv)
        hostFingerprint: SHA256:…             # strongly recommended
```

- The local shell needs the optional dependency `node-pty`, SSH needs `ssh2`; when missing, the target shows "unavailable" with an install hint. The same happens when pnpm skipped their build scripts; see below.
- SSH credentials come only from local key files or environment variables; they never pass through the browser and never appear in any response. The browser can only pick a target by `name`.

### Build scripts of the native dependencies {#native-build}

`node-pty`, `ssh2` and `cpu-features` (an optional dependency of `ssh2`) compile a native module when installed. Since pnpm 10, dependency build scripts do not run by default: pnpm only prints "Ignored build scripts" (pnpm 11 fails `pnpm install` outright), so `node-pty` is installed but cannot load and the local shell is unavailable. Allow them in the project's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  node-pty: true
  ssh2: true
  cpu-features: true
```

- Projects created by `create-zhin-app` already contain this. In an existing project, run `zhin migrate` (preview with `--dry-run` first): missing entries are added, existing ones are kept, and an entry set to `false` is left alone.
- pnpm 11 only reads `allowBuilds` and no longer reads the `pnpm` field of `package.json`; pnpm releases before 10.26 read `onlyBuiltDependencies`. When the project already has an `onlyBuiltDependencies` list (in `pnpm-workspace.yaml` or `package.json#pnpm`), `zhin migrate` appends to it too.
- After allowing them, run `pnpm install` (or `pnpm rebuild node-pty`) to build. Platforms without prebuilt binaries need Python and a C/C++ toolchain.
- `zhin doctor` loads the gateway's `node-pty` from the project directory and warns with the repair command when it fails; projects without `@zhin.js/gateway` are skipped. npm runs build scripts by default; use `npm rebuild node-pty` when the build failed.

### Pinning SSH host fingerprints {#ssh-fingerprint}

With `hostFingerprint`, the gateway compares the target's host key strictly and refuses to connect on a mismatch; **without it, any host key is accepted**, so a man in the middle can impersonate the target and capture your session. Take the fingerprint from a trusted machine before deploying:

```bash
ssh-keyscan -t ed25519 10.0.0.12 2>/dev/null | ssh-keygen -lf -
# 256 SHA256:AbCd… 10.0.0.12 (ED25519)
```

Copy the `SHA256:…` part into `hostFingerprint` as is, and update it whenever the target is reinstalled or rekeyed.

### Use and permissions

1. **Operations → Terminal** (`/ops/terminal`) lists the targets (`GET {base}/console/terminal/targets`).
2. After you pick one, the Console requests a one-time ticket (`POST {base}/console/terminal/tickets`, valid for 30 seconds, bound to the current user) and opens the WebSocket `{base}/console/terminal?ticket=…` with it. Long-lived tokens never appear in URLs.
3. Each tab is one session; disconnecting ends the session — nothing keeps running in the background.

- Requires `ops.terminal`, which among built-in roles only `owner` holds; it can come from a user session or a user API token, never the bootstrap token.
- On idle timeout, when the user is disabled or changes password, or when the configuration turns the terminal off, the server sends `exit`, closes the connection and ends the process.
- The audit log records session start (user, target, IP) and end (duration, exit code, reason), never input or output.
