---
title: "Version Compatibility and Migration"
description: "Upgrade Zhin safely: compatibility boundaries, preparation, execution steps, when to roll back, and plugin authors' versioning duties"
---

# Upgrade Zhin, not just a version string

An upgrade changes dependencies, Feature APIs, configuration, durable data and the running plugin versions. The safe flow is: **rehearse first, back up, then verify against what actually runs**.

A routine patch upgrade usually needs only:

```bash
npx zhin migrate --dry-run   # see what would change
npx zhin migrate             # upgrade
npx zhin doctor && pnpm test # check
npx zhin runtime start --once --mode test  # assembly smoke test
```

For production, follow the full flow below and take a backup first. Stop the Bot before upgrading so dependency directories are not replaced under a running process.

## Upgrading from 1.1.13 or earlier: configVersion 2 {#configversion-2}

::: warning Breaking config change
Starting with `@zhin.js/cli` 1.1.14 the Runtime only accepts `configVersion: 2` (flat plugin configuration). After a `^1.1.x` project picks up the new packages, the old config is rejected at startup with an error containing `configVersion must be 2`; newer CLIs say "Detected a v1 configuration" directly. Migrate in this order and do not skip steps.
:::

1. **Stop the Bot before upgrading dependencies.** pnpm removes old version directories during the upgrade, so a running process can crash mid-upgrade or load a mix of old and new files.

   ```bash
   zhin stop   # also stop foreground, systemd, pm2 or launchd managed processes
   ```

2. **Upgrade to a CLI that has the migration command (1.1.14 or later).** `zhin migrate` in 1.1.13 and earlier only upgrades dependencies and scripts and has no `instances` subcommand.

   ```bash
   pnpm add zhin.js@latest @zhin.js/cli@latest
   pnpm install
   ```

   Older `zhin migrate` versions also rewrite exact pinned versions to `latest`, so check with `--dry-run` first; newer versions keep pins by default.

3. **Preview the config migration** (writes nothing and prints no config values):

   ```bash
   zhin migrate instances
   ```

4. **Apply it** (originals are backed up first):

   ```bash
   zhin migrate instances --apply
   ```

   Originals are kept in `.zhin/instance-declarations-migration/`; newer CLIs also copy them to `.zhin/backups/config-v2-<timestamp>/` and print that path.

5. **Check and start again**:

   ```bash
   zhin config check
   zhin doctor
   pnpm start
   ```

**Restore**: keep the Bot stopped and run `zhin migrate instances --recover rollback`, or copy the files back to the paths listed in the backup's `manifest.json` and delete `.zhin/instance-declarations-migration`. If a migration was interrupted, `--recover continue` finishes it. To run the old version again you also need to restore dependencies and the lockfile to 1.1.13.

Cases the tool refuses to convert automatically (nested plugins, per-mount optional, instance names colliding with reserved keys) are covered in [Migrating to flat plugin configuration](../migrations/plugin-instance-declarations.md).

## Compatibility boundaries

| Boundary | Contract |
| --- | --- |
| Node | `>=22.19.0` |
| Root and plugin | semver in `package.json#zhin.engine` |
| Feature consumer/provider | `features[].api` and Feature `featureApi` |
| Zhin package family | one resolved release combination in the lockfile |
| Console | public Host REST/RPC/SSE contract and public client types |
| Durable data | version-specific schema, Journal, and migration notes |

Commit the production lockfile and never boot from a drifting `latest` resolution. `zhin migrate` targets non-workspace Zhin dependencies at `latest`; it is an explicit upgrade action, not a deployment command.

Explicit `workspace:` dependencies are always preserved, including when migration runs from a workspace child package. A missing `pnpm-workspace.yaml` in the current directory does not turn a local link into a registry dependency. Fix workspace declarations and package names when resolution fails rather than changing the dependency source during migration.

`migrate` installs dependencies by default; only `--no-install` skips installation. The pnpm install refreshes the lockfile to match the migrated manifest (`--no-frozen-lockfile`, including in CI). If the current directory has only an npm lockfile but declares `workspace:` dependencies, migration stops before changing files because npm cannot install that protocol. Check the pnpm workspace configuration first, or explicitly use `--no-install` to migrate only the manifest and handle installation separately.

## Before upgrading

```bash
zhin migrate --dry-run
zhin doctor
```

Read root Changesets/CHANGELOG and affected package notes. Check breaking manifests, Feature APIs, removed config, database migrations, and Adapter connection changes.

Create one checkpoint: Git commit, `package.json`, lockfile, config, `.env` key inventory, database snapshot, Workroom store, and `data/schedule-jobs.json`. Protect secret values separately.

## Execute

1. Run `zhin migrate --dry-run` on a copy or staging environment.
2. Enter a maintenance window and stop the Bot and any ingress that creates new side effects (before upgrading dependencies).
3. Run `zhin migrate` and review package, script, and directory changes.
4. Run doctor, type checks, tests, and `runtime start --once --mode test`.
5. Start production and accept Sandbox, a real Endpoint, Agent, and Workroom.

Never share one writable SQLite file or file Journal between live instances. Blue/green release needs isolated copies and an explicit cutover; only one instance may own write authority.

## Rollback decision

Stop the release if the candidate cannot publish, Endpoints cannot recover, SSE history has an unrebuildable gap, Workroom authority fails, or a data migration has no recovery plan.

Restore the complete checkpoint. Database recovery cannot undo real messages, approvals, Git operations, or payments. Use idempotency keys, Effect Ledger, or human compensation for external effects.

## Plugin author responsibility

- Use a major changeset for breaking public API.
- Update provider, consumer requirements, and API surface snapshots with a Feature API.
- Reject removed config with a migration target; do not retain a silent dual path.
- Install the real tarball before release and verify JS entry, `files`, peers, and README.

See [Production deployment and operations](./production).
