---
title: Setup and Onboarding
description: Opening the Console for a new project - the database, owner, AI and adapter steps, the credential and permissions each needs, and the matching CLI commands
---

# Setup and Onboarding

`create-zhin-app` only creates a minimal project ([ADR 0053](../../adr/0053-console-onboarding.md)). The database, owner account, AI and adapters are set up in the Console after the Host starts. Onboarding is served by the management gateway, so it works before the instance is up.

## Opening onboarding {#open}

```bash
npm create zhin-app my-bot     # asks only: language, project name, bootstrap token
cd my-bot
pnpm dev                       # = zhin start --foreground --watch source config
```

At the end of creation (and after `zhin start` starts) the terminal prints a Console link:

```text
https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=<bootstrap token>
```

- The token sits after `#`, so it is never sent to console.zhin.dev's server; the Console removes it from the address bar as soon as it reads it, and asks you to confirm the first connection to an unknown Host.
- Non-interactive terminals (CI logs) print the link without the token; the token is `HTTP_TOKEN` in `.env`.
- Lost the link? Open [console.zhin.dev](https://console.zhin.dev), set API Base to `http://127.0.0.1:8068` (per `http.port`) and use `HTTP_TOKEN` as the token.

## The five steps {#steps}

| Step | Credential | What happens | Permissions |
| --- | --- | --- | --- |
| 1. Database | Bootstrap token | Pick a driver (SQLite / MySQL / PostgreSQL / MongoDB), install the driver package online if needed, fill in the connection, test, save | — |
| 2. Owner | Bootstrap token | Create the first owner and sign in; the bootstrap token is refused everywhere afterwards | — |
| 3. AI | Owner session | Enable AI or not; install AI dependencies; add and test the first model provider | `plugin.manage` + `agent.configure` |
| 4. Adapters | Owner session | Pick platforms (several allowed), install adapter packages, fill in and test the first account of each | `plugin.manage` + `endpoint.manage` |
| 5. Finish | — | Summary, then the dashboard | `plugin.manage` |

- Every step can be skipped and revisited. Steps 3 and 4 are also available after onboarding under **Features → AI and models** and **Features → Adapters**, using the same pages and APIs.
- **Database**: keeping the default SQLite (`.zhin/data.sqlite`) is enough to continue. When the configuration already declares `database`, the step is skipped by default. The connection is always tested before saving; secret fields go to `.env` and the configuration keeps only `${…}` references. After a switch the gateway reconnects to the new database and restarts the instance; plugin data in the old database is not migrated.
- **Online installs** are limited to packages in the official catalog: database drivers (`mysql2`, `pg`, `mongodb`), adapter packages, AI dependencies and marketplace entries. The bootstrap token can only install database drivers; every other install goes through the gateway's dependency transaction (stop instance → install → start instance, rollback on failure), see [Dependency installs and rollback](./operations.md#packages).
- A local Host without `http.token` is open to everyone until setup (fine for local development only); always configure `http.token` before exposing a Host.

## Onboarding state {#state}

Progress is kept in `.zhin/onboarding.json` (not in the database, because the database is not decided before step 1):

```json
{ "version": 1, "steps": { "database": "done", "owner": "done", "ai": "skipped", "adapters": "pending" } }
```

| Endpoint | Purpose |
| --- | --- |
| `GET {base}/auth/setup` | Setup status with the `onboarding` field (bootstrap token) |
| `GET {base}/auth/me` | Callers holding `plugin.manage` also receive `onboarding` |
| RPC `onboarding.update` | `{ step: 'ai' \| 'adapters' \| 'finish', status: 'done' \| 'skipped' }`; needs `plugin.manage`, plus `agent.configure` for `ai` and `endpoint.manage` for `adapters` |

After an existing project upgrades, steps already present in its configuration (database / adapters / AI) are marked done automatically; only the owner remains to be created.

## CLI equivalents {#cli}

Every onboarding step is a method of the same service; the CLI and the Web are two shells with identical validation and writes:

| Step | Command |
| --- | --- |
| 1, 2 | `zhin console init`; non-interactive: `printf '%s\n' "$PASSWORD" \| zhin console init --yes --owner admin --password-stdin` (optionally `--database <dialect> --database-<field> <value>`) |
| 3 | `zhin setup --ai` |
| 4 | `zhin setup --adapters` |
| Status | `zhin console init --status` |

## Related

- [Quick Start](../getting-started/index.md)
- [Access control](./access-control.md): adding users and issuing API tokens after onboarding
