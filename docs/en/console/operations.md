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
| Environment variables | `/ops/env` | `ops.env.read` (masked values only) | `ops.env.write`; **Show** (the value as written) needs `ops.env.read` + `ops.env.write` |
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
- **Versions**: the current and latest npm versions of Zhin (`zhin.js`), the gateway, the Console packages and the installed `@zhin.js/*` plugins (`gateway.version.check`, needs `status.view`). The gateway queries the registry the project's npm configuration (`.npmrc`, mirrors included) points to and caches the answers in memory for about 6 hours, so this works while the instance is stopped; offline or on a timeout it shows **Cannot check for new versions** instead of an error. When the new version is within the range declared in `package.json`, use **Update** on that row of **Project dependencies**; when it is outside (a new major, a range change or migrations), the Console only shows the command `npx zhin migrate --dry-run` — framework upgrades go through the CLI's [`zhin migrate`](../cli/index.md#migrate) only ([ADR 0062](../../adr/0062-one-path-per-task.md)); the Console never changes version ranges.
