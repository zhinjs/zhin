---
title: Upgrading to Console access control
---

# Upgrading to Console access control

The Console no longer trusts tokens from the config file. Users, roles, sessions and API tokens live in the project database (`.zhin/data.sqlite` when no database is configured), every Console endpoint checks a permission, and every denied request and every write is audited. See [ADR 0049](../../adr/0049-console-rbac.md) for the design.

After upgrading to `@zhin.js/cli` 1.2 or later, work through these steps in order.

## 1. Initialize first: create the first owner

On the first start after the upgrade the database has no users. Until one exists, `http.token` is a **bootstrap token**: it can only create the first owner, not read status or change configuration. Once the owner exists, it stops working everywhere.

Two ways to do it, both running the same setup:

- **Console wizard**: open the Console, enter the Host address and `http.token`, pick a database (the default SQLite is fine) and create the owner. Sign in with that account from then on.
- **Command line**: in the project directory run

  ```bash
  zhin console init
  ```

  In scripts or containers use the non-interactive form:

  ```bash
  printf '%s\n' "$OWNER_PASSWORD" | zhin console init --yes --owner admin --password-stdin
  ```

Leaving `http.token` in the config is harmless: it is refused after setup. A local Host without `http.token` is open to everyone until setup (as before), so set `http.token` before exposing a Host to a network.

Forgot the password or locked out the owner: stop the Host and use the offline commands `zhin console user passwd <username>`, `zhin console user enable <username>` or `zhin console user create <username> --role owner`. There is no online super credential.

## 2. Replace `http.tokens` with users and API tokens

`http.tokens` is removed. The Host refuses to start while the config still has it and tells you to delete it.

| Before | Now |
| --- | --- |
| `http.token` (full) | Bootstrap token; afterwards sign in as the owner |
| `scope: user` members of `http.tokens[]` | Create a user for each in Console → Access, bound to a role (`viewer` read-only, `operator`, `admin`), optionally scoped to one adapter or account |
| `scope: demo` tokens | Demo mode is removed. Give the demo site a `viewer` account |
| Plugin permissions in `http.tokens[].permissions` (such as `onebot11:read`) | Granted to built-in roles by level: `*:read` to `viewer` and above, day-to-day actions to `operator` and above, undeclared `*:write` plus `*:approve` / `*:manage` and similar to `admin` (adapter account writes and built-in plugins' `:write` are declared `operate`); custom roles and API tokens can also list them directly (see [Plugin permission levels](../console/index.md#plugin-permission-levels)) |

Delete `http.tokens`, then start the Host.

## 3. Use API tokens for automation

CI, monitoring, `zhin doctor --live`, `zhin config --host`, `zhin plugin … --host` and anything else that used `http.token` or `ZHIN_HTTP_TOKEN`:

1. Sign in to the Console and issue a token under Access → API tokens. You can limit it to the permissions it needs (a readiness probe only needs `status.view`). The token is shown once.
2. Put it in `ZHIN_CONSOLE_TOKEN`:

   ```bash
   export ZHIN_CONSOLE_TOKEN=<API token>
   zhin doctor --live https://bot.example.com/api --json
   ```

An API token never has more permissions than the user who issued it; it stops working when that user is disabled or deleted, and it can be revoked on its own. `/pub/health` and `/pub/ready` stay public.

## 4. Adapter reverse WebSockets are unaffected

The reverse WebSockets of OneBot 11 / 12, NapCat and Milky (`connection: wss`) only accept the adapter's own `access_token` and have nothing to do with Console accounts, so client configuration does not change.

- With `access_token`: the client must send it as `Authorization: Bearer <access_token>` or `?access_token=`.
- **Without `access_token`: only local connections (127.0.0.1 / ::1) are accepted.** If the client runs on another machine or in a container, configure an `access_token` for that endpoint.

Webhooks and other plugin routes authenticate themselves as well.

## 5. Personal inference principals

`ai.personalPrincipals` used to bind a token from `http.tokens[].principalId` to a personal inference setup. With `http.tokens` gone, inference management in the Console always acts as the Host administrator (requires `agent.configure`); switching to a personal inference principal from the Console is not available for now.

## 6. Console terminal (optional)

The new Console terminal is off by default. Enable it in the config; only owners (`ops.terminal`) can use it:

```yaml
console:
  terminal:
    enabled: true
```

See the [configuration reference](../configuration/generated.md) for all fields. Once enabled, an owner credential is a shell on the host machine.

## Checklist

- [ ] An owner exists and can sign in to the Console
- [ ] The config has no `http.tokens`
- [ ] Automation uses an API token from `ZHIN_CONSOLE_TOKEN`
- [ ] Every reverse WebSocket endpoint reached from another machine has an `access_token`
