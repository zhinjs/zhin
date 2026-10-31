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

## Adapter API 2: this patch batch's plugin boundary {#adapter-api-2}

This patch batch intentionally changes plugin interfaces. `1.1.x` alone does not prove compatibility.
The following are the first target versions, not a claim that publication has already occurred.
Verify the formal release inventory, then upgrade the complete dependency set and lockfile together.

| Package / contract | Last old-interface version | First new-interface version |
| --- | --- | --- |
| `zhin.js` | `1.1.18` | `1.1.19` |
| `@zhin.js/core` | `1.1.53` | `1.1.54` |
| `@zhin.js/adapter` | `1.1.25`, Feature API `1.0.0` | `1.1.26`, Feature API `2.0.0` |
| `@zhin.js/feature-kit` | `1.1.9` | `1.1.10` |
| Runtime / Isolate | `1.1.15` | `1.1.16` |
| Plugin Runtime / Agent | `1.1.17` / `1.1.44` | `1.1.18` / `1.1.45` |
| 19 other official platform adapters | Each package `1.1.18` | Each package `1.1.19` |
| Bilibili / Bilibili-live adapters | Each package `0.1.1` | Each package `0.1.2` |
| Sandbox adapter | `1.1.20` | `1.1.21` |

New adapters declare `{ "package": "@zhin.js/adapter", "api": "^2.0.0" }` in `zhin.features`.
The existing Feature API check refuses explicit `^1.0.0` consumers on API 2 and `^2.0.0` consumers
on API 1. `zhin.engine` keeps its independent `^1.0.0` contract; it is not the npm version above.
Missing `api` metadata keeps its existing behavior. It does not certify compatibility: authors and
operators must check actual dependency versions, old API use and the lockfile. Old npm tarballs'
broad peer ranges cannot be changed retroactively.

Republish custom adapters using `createAdapter`, actual Client inheritance and `endpointSpec`.
Augment `AdapterRegistry` only through a directly declared FeatureKit peer/dev dependency. Migrate
control/management methods to named requests and Host controls to canonical message/conversation
refs without redundant account selectors. Preserve third-party SDK signatures. Supply Satori and
OneBot12 `platform + userId`, and the actual WeCom `agentId`. See [adapter authoring](../authoring/adapters.md).

Rehearse on copied data first. Back up the old lockfile, account identities and encryption-key
material, databases, plugin state, Owner approvals and any existing migration plans/journals.
Historical aliases do not automatically select an account, parent channel or thread. Use the
authenticated `/api/data-migrations` preview to select exact targets and prepare a plan, then
explicitly apply. Application leaves maintenance paused; inspect and resume separately. No automatic
notification replay, game deadline extension or permission recovery occurs. Reconcile after an
unknown/disconnected outcome instead of treating an absent receipt as proof that retry is safe.

Owner V2 approvals remain inactive historical grants; new writes use V3. Old code cannot read V3,
so rollback needs matching code, lockfile and verified data, not just an npm downgrade. Restore
requires unchanged after-images; preserve later business writes and resolve conflicts explicitly.
Keep plans/domain journals and require fresh authorization for historical permissions. These
instructions do not authorize real account operations, publishing, deployment or production migration.

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
