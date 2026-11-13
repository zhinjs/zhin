---
title: "Upgrading: Console accounts move to .zhin/gateway.db"
description: Console users, roles, sessions, API tokens and the audit log move from the project database to the gateway's own .zhin/gateway.db — automatic migration, the 503 until it finishes, the restricted SQL console account on PostgreSQL / MySQL, backups and reverting
---

# Upgrading: Console accounts move to `.zhin/gateway.db` (ADR 0059)

Console users, roles, role bindings, sessions, API tokens and the audit log used to live in six `console_*` tables of the **project database**. From this release they live in the gateway's own SQLite file `.zhin/gateway.db` ([ADR 0059](../../adr/0059-gateway-storage-isolation.md), Chinese), whatever dialect the project database uses:

| | Before | Now |
| --- | --- | --- |
| Console accounts, sessions, tokens, audit | `console_*` tables of the project database | `.zhin/gateway.db` (`0600`) |
| Who opens it | the gateway, sharing the database with the instance | the gateway only (`zhin console …` while no gateway runs; `--standalone` development mode) |
| redis / memory projects | no Console accounts | Console accounts work |
| Console SQL editor (PostgreSQL / MySQL) | runs as the main account | runs only as a restricted account (section 3) |

Plugin data, conversation records, feature overrides and so on stay in the project database.

## 1. Automatic migration

On the first `zhin start` after upgrading, the gateway, while it connects:

1. Looks for the six old tables in the project database (system catalog only, nothing is created; a missing SQLite file or a redis / memory project means "nothing to migrate");
2. Exports every row to `.zhin/backups/gateway-db-<time>/console-tables.json` (`0600`);
3. Copies them inside one gateway.db transaction, checking row counts and checksums per table before it commits;
4. Checks again and drops the six tables from the project database;
5. Records `done` in `gateway_meta.legacy_import` of gateway.db.

**Until the migration finishes Console sign-in is unavailable**: `/auth/login` and friends answer `503 iam_unavailable`, `/auth/me` answers anonymous with an `unavailable` reason, and the bootstrap token (`http.token`) is refused too — an empty gateway.db is never taken for "no owner yet". The usual cause is a project database that cannot be reached for now; the gateway retries every 10 seconds and `zhin logs` shows `gateway_legacy_import_failed`. SQLite projects finish within a second.

Old passwords, sessions and API tokens keep working after the migration; nobody has to sign in again.

With no gateway running, `zhin console init` / `zhin console user …` run the same migration first. You can also run it yourself:

```bash
zhin console migrate          # migrate (only reports the state while a gateway runs)
zhin doctor                   # the "Console 账号存储" (account store) check shows the state
```

- If the old tables were written after the copy and before the drop (an old version still running), their content as dropped is exported to `console-tables-changed.json` in the same directory; gateway.db keeps the copied data and `zhin doctor` warns;
- If the tables show up in the project database again later (an old version ran once more), the new version does not read them and `zhin doctor` suggests dropping them;
- If gateway.db already holds data without a migration record, the migration refuses to merge: check `.zhin/gateway.db` (delete it and migrate again if needed).

## 2. Deployment: persist `.zhin/`

gateway.db lives under `.zhin/`. Container deployments must keep `.zhin/` (at least `.zhin/gateway.db*` and `.zhin/keys/`) on a persistent volume, or recreating the container loses every Console account, session, token and audit entry.

**Backups**: back up `.zhin/gateway.db` for every dialect — `pg_dump` / `mysqldump` no longer contain Console accounts. While the gateway runs, use SQLite's online backup (e.g. `sqlite3 .zhin/gateway.db ".backup gateway-backup.db"`), or copy it together with its `-wal` file while stopped. See [Production deployment](../operations/production.md).

## 3. PostgreSQL / MySQL: the restricted account of the SQL editor

The SQL editor of the Console database page (`db:query` / `db:execute`) now runs only on a **separately logged-in restricted account**. Without one it is off (`capabilities.sql = false`, the page shows why); data browsing and the schema editor are unaffected.

```bash
zhin db console-role              # creates the account with the main account, password to .env, reference in database.console
zhin restart
```

The configuration holds references; the password lives only in `.env`:

```yaml
database:
  dialect: pg
  # …main account connection…
  console:
    user: ${ZHIN_DB_CONSOLE_USER}
    password: ${ZHIN_DB_CONSOLE_PASSWORD}
```

- If the main account may not create accounts (common on managed databases): `zhin db console-role --print-sql` only prints the SQL (the password is the placeholder `<ZHIN_DB_CONSOLE_PASSWORD>`, the real value is in `.env`); have a DBA run it, then `zhin restart`;
- `zhin doctor --fix` does the same;
- At start the instance only **probes** the account (not a superuser, cannot create roles / databases / schemas, member of no other role, on MySQL privileges on this database only, …); if it fails, the SQL editor is off with the reason and the probe runs again at most every 5 minutes. On PostgreSQL the main account also grants it access to tables created since;
- **On PostgreSQL the SQL editor cannot run DDL** (`CREATE` / `ALTER` / `DROP` answer 42501 insufficient privilege): use the Console schema editor;
- SQLite needs no restricted account: the accounts are in another file and the instance connection refuses `ATTACH`.

## 4. Going back to an older version

Older versions only read the tables in the project database. Before downgrading:

```bash
zhin stop
zhin console migrate --revert
```

It copies gateway.db to `.zhin/backups/gateway-db-<time>/`, writes the six tables back into the project database and verifies them, then empties them in gateway.db. It refuses when those tables already hold rows in the project database. Then install the older version; upgrading again migrates again.

## 5. Integrations and plugins

- Plugins never had access to the `console_*` tables; now they are not in the project database at all. On SQLite a plugin's `ATTACH` on the raw handle is refused and its transaction rolled back.
- `@zhin.js/gateway/iam` no longer exports `IAM_DIALECTS`; `installConsoleIam` takes `projectDatabase` (the `--standalone` composition). `createDatabaseHost` of `@zhin.js/core` no longer has `gatewayTableHost()`.
- To read gateway.db while a gateway runs, go through the local control socket (`zhin console …`); do not open another connection.
