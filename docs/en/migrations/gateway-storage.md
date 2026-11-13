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

**Until the migration finishes Console sign-in is unavailable**: `/auth/login` and friends answer `503 iam_unavailable` (`reason` is a category code such as `migration_pending`), `/auth/me` answers anonymous with a generic note and `unavailableCode`, and the bootstrap token (`http.token`) is refused too — an empty gateway.db is never taken for "no owner yet". The actual reason (paths, driver messages) only goes to the logs and to you on the server through `zhin doctor` / `zhin console migrate`. While the project database cannot be reached the gateway retries (from 10 seconds, doubling, at most 5 minutes) and `zhin logs` shows `gateway_legacy_import_failed`; failures that need a person (conflicting data, a copy that did not verify, old tables without an `id` column) are not retried — `zhin doctor` reports them; fix, then `zhin stop && zhin start`. Repeated failures do not write backups over and over: the same old rows are backed up once (`.zhin/backups/gateway-db-legacy-<digest>`). SQLite projects finish within a second.

After the migration (or the decision that there was nothing to migrate) the gateway writes a marker table `zhin_gateway_store` into the project database with the random id of the current gateway.db. If gateway.db is later lost or replaced by another file, the gateway notices, keeps the Console closed (the bootstrap token does not come back) and points to two ways out:

- restore `.zhin/gateway.db` from a backup;
- accept that the old accounts are gone: `zhin stop`, then `zhin console init --reset-store` (asks for confirmation; `--yes` skips it). It points the marker at the current gateway.db, records `auth.store.reset` in the new audit log and continues with the normal setup.

On the first start of a SQLite project the instance has not created the project database file yet; the gateway creates it (same path) to write the marker. redis / memory projects have nowhere to keep the marker: persisting `.zhin/` matters even more there. When the current gateway.db already holds accounts, `--reset-store` only points the marker at it and deletes nothing.

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
- At start the instance only **probes** the account (not a superuser, cannot create roles / databases / schemas, cannot create objects in any schema, owns no object, role settings unchanged, member of no other role, on MySQL privileges on this database only and no roles or PROXY grants, …); if it fails, the SQL editor is off with the reason and the probe runs again at most every 5 minutes. A healthy account is probed again every 60 seconds and before the first use after an error on its connection. On PostgreSQL the main account also grants it access to tables created since and revokes anything on gateway tables;
- The probe also turns the SQL editor off when the account can execute server file / remote functions (`pg_read_file`, `pg_ls_dir`, `lo_export`, `dblink*`, …), use tables outside schema `public`, owns large objects, or holds any column privilege on a gateway table. On managed PostgreSQL where an extension (e.g. dblink) leaves such functions executable by PUBLIC, the SQL editor stays off until you revoke them;
- On PostgreSQL the probe turns the SQL editor off when the account can execute a SECURITY DEFINER function owned by another role (PUBLIC may execute every function by default; extension functions count too): such functions run with their owner's rights. `zhin db console-role` does not change this for you (it would affect other users); for each function the instance log names, run `REVOKE EXECUTE ON FUNCTION <schema>.<function>(<argument types>) FROM PUBLIC`, grant it only to the roles that need it, then `zhin restart`;
- Restrict the account to the instance's host in `pg_hba.conf` (or the host part of the MySQL account). On PostgreSQL the account is created with a client-computed SCRAM verifier, so the `--print-sql` output can go to a DBA as is;
- **On PostgreSQL the SQL editor cannot run DDL** (`CREATE` / `ALTER` / `DROP` answer 42501 insufficient privilege): use the Console schema editor;
- SQLite needs no restricted account: the accounts are in another file and the instance connection refuses `ATTACH`.

## 4. Going back to an older version

Older versions only read the tables in the project database. Before downgrading:

```bash
zhin stop
zhin console migrate --revert
```

It copies gateway.db to `.zhin/backups/gateway-db-<time>/`, writes the six tables back into the project database and verifies them, then empties them in gateway.db, drops the marker table and revokes the restricted account's access to those tables (on PostgreSQL its default privileges too) — older versions do not use the account: drop it and `database.console` as the command tells you. It refuses when those tables already hold rows in the project database. Then install the older version; upgrading again migrates again.

## 5. Integrations and plugins

- Plugins never had access to the `console_*` tables; now they are not in the project database at all. On SQLite a plugin's `ATTACH` on the raw handle is refused and its transaction rolled back.
- `@zhin.js/gateway/iam` no longer exports `IAM_DIALECTS`; `installConsoleIam` takes `projectDatabase` (the `--standalone` composition). `createDatabaseHost` of `@zhin.js/core` no longer has `gatewayTableHost()`.
- To read gateway.db while a gateway runs, go through the local control socket (`zhin console …`); do not open another connection.
- A plugin's raw database handle (`getRawDatabase()`) and its transaction handles check every string-like argument of every method for gateway table names (`queryStatement` included, strings inside arrays and objects, `$raw` conditions, `new String(…)` and objects with their own `toString`) and throw `GatewayOwnedTableError` on a match. Argument data that literally names a gateway table (inserting the text `console_users`, say) is refused as well; string-like objects are converted to a string once, and that string is what the driver gets.
- When the Agent's `bash` runs in the Docker sandbox, the project's `.zhin/` is an empty directory in writable and read-only turns alike. Code that uses `Sandbox` itself with `useDocker: 'auto'` falls back to running on the host when Docker is missing, where `.zhin/` is readable (a warning is logged); use `useDocker: 'always'` when isolation is required.
