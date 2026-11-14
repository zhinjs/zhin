---
title: "Access Control: Users, Roles, API Tokens and Audit"
description: The four pages of the Console Access control section - who can sign in, what they can do, how automation gets credentials, and how to investigate; permission names and CLI rescue commands
---

# Access Control: Users, Roles, API Tokens and Audit

Console accounts live in the gateway's own `.zhin/gateway.db`, not in the project database ([ADR 0049](../../adr/0049-console-rbac.md), [ADR 0059](../../adr/0059-gateway-storage-isolation.md)); the management gateway handles sign-in and authentication ([ADR 0054](../../adr/0054-management-gateway.md)). These pages keep working while the instance is stopped or crashed.

The **Access control** group in the sidebar has four pages: **Users** (`/access/users`), **Roles** (`/access/roles`), **API tokens** (`/access/tokens`) and **Audit log** (`/access/audit`). Reading needs `iam.view`, changes need `iam.manage` — among the built-in roles only `owner` holds `iam.manage`; `admin` has `iam.view`; without `iam.manage` the pages are read-only. Accounts without `iam.view` do not see the group. Deleting, disabling and revoking ask for confirmation, and deleting a user or role asks you to type its name.

The roles here are **Console account** roles: they decide who can do what in the Console. The **Roles** tab of the object pages manages **chat roles** (Owner / Administrator / Trusted), which decide who can use the bot's features in chat; the two never affect each other (see [chat roles](../concepts/chat-roles.md)). Everyone changes their own password and issues their own API tokens in Personal settings (`/account`, from the user name in the top bar).

## Credentials {#credentials}

| Credential | Where it comes from | Used for |
| --- | --- | --- |
| Bootstrap token | `http.token` in the configuration (scaffolded into `HTTP_TOKEN` in `.env`) | Only the setup wizard before any owner exists ([Onboarding](./onboarding.md)); returns 401 everywhere once the owner exists |
| Session token | Username + password sign-in (`POST {base}/auth/login`) | The Console in the browser. 12-hour sliding expiry by default, 30 days at most |
| API token | Issued by a user (below) | CI, monitoring, `zhin doctor --live`, MCP / A2A clients; command-line tools read `ZHIN_CONSOLE_TOKEN` |

With neither `http.token` nor an owner, the Host is **open**: it holds every permission and only accepts loopback peers without `X-Forwarded-For` / `Forwarded` (a request with an unknown peer address is not local). The gateway refuses to start open when `http.host` is not a loopback address (e.g. `0.0.0.0` in a container): first run `zhin doctor --fix` to generate `HTTP_TOKEN` in `.env` and set `http.token: ${HTTP_TOKEN}`, or create the owner with `zhin console init`. A same-host reverse proxy that adds no forwarding header makes every proxied request look local to an open Host, so always set a bootstrap token behind a reverse proxy.

Every credential is sent as `Authorization: Bearer …`; no cookies are used. Failed sign-ins always return 401; after 5 failures per IP and username within 15 minutes the gateway backs off exponentially (`429`).

## Users {#users}

Lists every user: username, display name, roles, status and when the password last changed. Each row's manage menu has **Change display name**, role bindings, reset password, disable / enable and delete.

| Action | RPC | Permission |
| --- | --- | --- |
| List | `iam.users.list` | `iam.view` |
| Create (lowercase unique username, password of at least 10 characters) | `iam.users.create` | `iam.manage` |
| Change display name (the username is for sign-in and cannot change after creation) | `iam.users.update` | `iam.manage` |
| Disable / enable | `iam.users.disable` | `iam.manage` |
| Delete | `iam.users.delete` | `iam.manage` |
| Reset password | `iam.users.reset-password` | `iam.manage` |
| Change role bindings | `iam.bindings.set` | `iam.manage` |

- Changing a password, disabling or deleting a user ends all of that user's sessions immediately; disabling or deleting also invalidates the API tokens they issued.
- Those actions and binding changes also close the event streams and WebSockets the user has open on the instance (they reconnect with the new permissions); binding changes apply to the next request immediately, because every request is authorized against the current bindings.
- There is always at least one enabled user with a global `owner` binding: deleting, disabling or demoting the last owner is refused.
- Every user can change their own password under personal settings (`POST {base}/auth/password`).

### Bindings and scopes {#scopes}

A binding = role + scope:

| Scope | Key | Covers |
| --- | --- | --- |
| Global | — | Everything |
| Adapter | Adapter instance alias, e.g. `qq` | That adapter and all its accounts |
| Account | `<alias>/<endpointId>`, e.g. `qq/bot-1` | Only that account |

Only `endpoint.view`, `endpoint.operate`, `endpoint.manage`, `feature.configure` and `feature.toggle` are narrowed by scope; every other permission counts only from global bindings. Example — "an operator for Telegram only": bind `operator` with the adapter scope `tg-main`.

## Roles {#roles}

Built-in roles cannot be changed or deleted, but can be copied:

| Role | Permissions |
| --- | --- |
| `owner` | Everything (including `ops.terminal` and `iam.manage`) |
| `admin` | Everything except `ops.terminal`, `ops.database.schema` and `iam.manage` |
| `operator` | `status.view`, `endpoint.view`, `endpoint.operate`, `feature.view`, `feature.configure`, `feature.toggle`, `agent.view`, `ops.schedule.read`, `plugin.perms.read`, `plugin.perms.operate` |
| `viewer` | Every `*.view` and `*.read` except `ops.config.read` and `ops.env.read` (they may contain secrets) |

| Action | RPC | Permission |
| --- | --- | --- |
| List roles and the plugin permission catalog | `iam.roles.list` | `iam.view` |
| Create / update / delete custom roles | `iam.roles.create` / `iam.roles.update` / `iam.roles.delete` | `iam.manage` |

### Permission catalog {#permissions}

| Permission | Covers |
| --- | --- |
| `status.view` | Home, system status, logs, capability browser, command permissions, the Records tab of object pages, event stream, instance status and logs |
| `endpoint.view` / `endpoint.operate` / `endpoint.manage` | Reading accounts and conversations / sending messages, handling requests, login assist / adding, changing, starting and stopping account connections |
| `feature.view` / `feature.configure` / `feature.toggle` | Reading feature configuration / writing configuration and overrides / enabling and disabling at the adapter, account and conversation levels (see [Feature matrix and layered configuration](./features.md)) |
| `plugin.manage` | Installing, updating and uninstalling plugins and dependencies; global plugin on / off (`disable_plugins`, a gateway transaction); onboarding steps 3–5 |
| `agent.view` / `agent.configure` | AI and Agent reads / writes |
| `ops.config.read` / `ops.config.write` | Raw configuration file |
| `ops.env.read` / `ops.env.write` | Environment files: read (masked values only) / save; showing one value as written (`env:reveal`) needs both and is audited |
| `ops.database.read` / `ops.database.write` | Database browser (sort, filter, table structure and schema change previews) / record edits |
| `ops.database.schema` | The SQL console (read-only queries and write SQL) and schema changes (add / rename / drop columns, change types, create tables, indexes); owner-only by default, every statement is audited with its literals redacted. See [Database](./operations.md#database) |
| `ops.schedule.read` / `ops.schedule.write` | Scheduled tasks (an explicit IM delivery target also needs `endpoint.operate` on that account) |
| `ops.files.read` / `ops.files.write` | Project files (reading or writing the configuration file still needs `ops.config.*`; `.env` / `.env.*` are never served as project files and are managed on the environment variables page `/ops/env` under `ops.env.*`) |
| `ops.restart` | Starting, stopping and restarting the instance |
| `ops.terminal` | Terminal (see [Operations](./operations.md#terminal)) |
| `iam.view` / `iam.manage` | This group; `iam.manage` also covers the Roles tab of object pages (`chat-roles.*`, checked by scope) |
| `mcp.access` / `a2a.access` | Bearer access to the MCP Server and A2A Server |
| `plugin.perms.read` / `plugin.perms.operate` / `plugin.perms.manage` | Every plugin permission of that level |

Every Console RPC, every `{base}` HTTP route and every Host-authenticated WebSocket is listed in the permission maps of `@zhin.js/console-protocol` (`CONSOLE_RPC_PERMISSIONS`, `CONSOLE_HTTP_PERMISSIONS`, `CONSOLE_WS_PERMISSIONS`); anything unlisted is denied to every signed-in principal.

### Plugin permissions {#plugin-permissions}

Plugin permissions are named `<plugin>:<action>` (`onebot11:read`, `ambient:read`, `ops:approve`) and belong to one of three levels — `read`, `operate`, `manage` — declared by the plugin in `definePluginConsoleRpc({ permissions })`. Undeclared levels are inferred from the suffix (`:read` / `:view` → `read`; `:approve` / `:manage` / `:admin` / `:write` / `:config` → `manage`; anything else → `operate`).

- `viewer` gets the `read` level, `operator` gets `read` + `operate`, `admin` and `owner` get all.
- Custom roles can tick level permissions or list plugin permission names directly. A name no loaded plugin uses can still be saved (the plugin may not be installed yet); the result carries `warnings`, and the name grants nothing until a plugin uses it.
- The role editor shows each role's effective plugin permissions with their source (`level` / `explicit`) and the catalog of loaded plugins' permissions (reported by the instance; while it is offline the gateway keeps the last one).
- Plugin Console RPC is authorized per method: the method's declared permissions and its page's requirements must both hold; when neither declares anything, read methods need `feature.view` and actions need `feature.configure`.

## API tokens {#api-tokens}

| Action | Endpoint | Permission |
| --- | --- | --- |
| My tokens (Personal settings `/account`) | `GET` / `POST {base}/auth/tokens`, `POST {base}/auth/tokens/revoke` | Any signed-in user |
| All tokens (filter by user) | `iam.tokens.list` | `iam.view` |
| **Issue for a user** / revoke | `iam.tokens.create` / `iam.tokens.revoke` | `iam.manage` |

On the API tokens page, click **Issue for a user**, pick the user and set a name and a validity period; issuing your own token in Personal settings works the same way. A token issued from the Console UI carries all of the user's permissions; when issuing through the API you can list only the permissions needed (a readiness probe needs only `status.view`, an MCP client only `mcp.access`), and the list shows it as narrowed to N items.

- The plaintext is **shown once, at issue time**; the database stores only its SHA-256.
- A token never exceeds its user: listed plugin permissions take effect only if the user holds them (by name or level); disabling or deleting the user invalidates the token; tokens can also be revoked individually.
- Command-line tools read `ZHIN_CONSOLE_TOKEN`: `ZHIN_CONSOLE_TOKEN=<token> zhin doctor --live https://bot.example.com/api --json`.
- MCP / A2A clients send the token as `Authorization: Bearer`; the issuing account must hold `mcp.access` / `a2a.access` **globally** (a grant limited to one scope does not count). The protocols' own `mcp.token` / `a2a.token` work as well; see [Configuration · mcp / a2a](../configuration/index.md#mcp-a2a). The bootstrap token stops working once the first owner exists and cannot be used for MCP / A2A.

## Audit log {#audit}

`iam.audit.list` (`iam.view`) pages through `console_audit_log`, filterable by principal, action and time.

| Recorded event | Details |
| --- | --- |
| Sign-in success / failure, sign-out, password change | Principal, IP |
| Every `iam.*` write | Changes to users, roles, bindings, tokens |
| RPCs mapped to a write permission | Writes on the instance are reported by the instance and written by the gateway |
| Showing an environment variable as written (`env:reveal`) | File, variable name, principal; never the value |
| Every denied request | `outcome: denied` |
| Terminal session start / end | Target, duration, exit code and reason; never input or output |

- Principals are written as `bootstrap`, `user:<id>` or `api-token:<id>`; `detail` records only the RPC type, target and parameter key names — never parameter values or secrets; `env:reveal` / `env:save` also record the file and the variable names involved (`set` / `deleted`).
- Entries are kept for 180 days and pruned daily.
- The gateway does not read `X-Forwarded-For`: behind a reverse proxy, the recorded IP is the proxy's.

## Offline rescue {#rescue}

Forgot a password or locked the owner out? Work on `.zhin/gateway.db` directly on the server (`zhin console user …`); no running gateway is needed and there is no online super-credential.

```bash
zhin console user list
printf '%s\n' "$NEW_PASSWORD" | zhin console user passwd alice --password-stdin
zhin console user enable alice
printf '%s\n' "$PASSWORD" | zhin console user create rescue --role owner --password-stdin
```

`zhin console user create` without `--role` creates a `viewer`.

## Related

- [Upgrading to Console access control](../migrations/console-access-control.md)
- [Deploying a demo site](../operations/demo-deployment.md): read-only accounts and hardening
- [Console overview](./index.md)
