---
title: "Operations: Instance, Dependencies and Terminal"
description: The Console Operations group - instance status, start / stop and logs, dependency installs and rollback, database / configuration / environment / schedules / files, and terminal safety
---

# Operations: Instance, Dependencies and Terminal

The **Operations** group in the sidebar answers "how is the host doing". The instance page, dependency installs and the terminal are served by the management gateway ([ADR 0054](../../adr/0054-management-gateway.md)) and **keep working while the instance crashes, stops or installs dependencies**; the database, configuration and schedule pages read from the instance or the project files. By default only `owner` / `admin` see this group (`operator` has only `ops.schedule.read`).

| Page | Route | Read | Write |
| --- | --- | --- | --- |
| Instance (with project dependencies) | `/ops/instance` | `status.view`; dependency list `feature.view` | Start / stop `ops.restart`; dependencies `plugin.manage` |
| Database | `/ops/database` | `ops.database.read` | `ops.database.write` |
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

- **Database**: browse tables, query with conditions, edit rows and the KV store. Writes hit the project database directly; there is no undo.
- **Configuration file**: view and edit `zhin.config.yml` in its current YAML / JSON format; saves carry the revision and roll back on failure. While the instance is offline the gateway reads and writes it. A plugin's settings are edited as a form on its global settings page (`/features/global/:plugin`); per-level overrides are in the Features tab of the object pages.
- **Environment variables**: the `.env` file. It may contain secrets, which is why `viewer` lacks `ops.env.read`.
- **Scheduled tasks**: opens on the **All tasks** overview, summarizing each task's status, next run, latest result, target and approval, filterable by status; creating, pausing and reading history happen in their own tabs: **Administrator tasks** (`?tab=admin`, create administrator tasks by use case), **Scheduled reminders** (`?tab=schedule`, plugin-registered and persisted tasks), **Assistant tasks** (`?tab=assistant`) and **Execution history** (`?tab=history`).
- **Project files**: the project file tree and text editing; reading or writing `.env` and the configuration file still needs `ops.env.*` / `ops.config.*`.

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

- The local shell needs the optional dependency `node-pty`, SSH needs `ssh2`; when missing, the target shows "unavailable" with an install hint.
- SSH credentials come only from local key files or environment variables; they never pass through the browser and never appear in any response. The browser can only pick a target by `name`.

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
