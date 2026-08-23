---
title: Version Compatibility and Migration
---

# Upgrade Zhin, not just a version string

An upgrade changes the package graph, Feature APIs, configuration, durable data, and runtime generation. Generate a plan first, back up authority, then accept through runtime facts.

## Compatibility boundaries

| Boundary | Contract |
| --- | --- |
| Node | `^20.19.0 || >=22.12.0` |
| Root and plugin | semver in `package.json#zhin.engine` |
| Feature consumer/provider | `features[].api` and Feature `featureApi` |
| Zhin package family | one resolved release combination in the lockfile |
| Console | public Host REST/RPC/SSE contract and public client types |
| Durable data | version-specific schema, Journal, and migration notes |

Commit the production lockfile and never boot from a drifting `latest` resolution. `zhin migrate` targets non-workspace Zhin dependencies at `latest`; it is an explicit upgrade action, not a deployment command.

## Before upgrading

```bash
zhin migrate --dry-run
zhin doctor
```

Read root Changesets/CHANGELOG and affected package notes. Check breaking manifests, Feature APIs, removed config, database migrations, and Adapter connection changes.

Create one checkpoint: Git commit, `package.json`, lockfile, config, `.env` key inventory, database snapshot, Workroom store, and `data/schedule-jobs.json`. Protect secret values separately.

## Execute

1. Run `zhin migrate --dry-run` on a copy or staging environment.
2. Enter a maintenance window and stop ingress that creates new side effects.
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
