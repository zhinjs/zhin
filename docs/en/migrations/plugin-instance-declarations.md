---
title: Migrating to flat plugin configuration
sidebar: false
---

# Migrating to flat plugin configuration

This is a breaking config format change. The Runtime only accepts `configVersion: 2` and no longer assembles application instances from `package.json#zhin.plugins` or `.zhin/plugin-lifecycle.json`. The old format can only be read by the explicit migration tool; it cannot start.

::: tip Upgrade order
Stop the Bot → upgrade to `@zhin.js/cli` 1.1.14 or later → preview with `zhin migrate instances` → `zhin migrate instances --apply` → `zhin config check`, then start. Full steps and restore options: [Version compatibility and migration](../operations/upgrades.md#configversion-2).
:::

## The three parts of the new config

The existing `zhin.config.yml` now holds the package mapping, the disabled list and same-named business config blocks:

```yaml
configVersion: 2

plugins:
  reminder: '@zhin.js/plugin-reminder'
  work-reminder: '@zhin.js/plugin-reminder'

disable_plugins:
  - work-reminder

reminder:
  timezone: Asia/Shanghai
  maxTasks: 20

work-reminder:
  timezone: UTC
  maxTasks: 5
```

Keys under `plugins` are instance names; values are installed npm packages or `./` local plugin paths. Instances not listed in `disable_plugins` are enabled. Disabling keeps the declaration and business config, does not uninstall the package, and does not load the instance entry. Several instances of one package use different names and keep separate config. Plugins still read their own values through `context.config.get()`.

Host, AI, database and the Root's own `plugin` config stay where they were. Do not use reserved keys such as `ai`, `database`, `http`, `plugin`, `plugins`, `disable_plugins` or `configVersion` as instance names. The menu settings `menuKeyword` and `menuStyle` also stay at the top level next to `plugins`.

## Using the migration CLI

These commands only convert files; they never log in to platforms, start plugins or call models:

```bash
# preview only; nothing is written and no config values are printed
zhin migrate instances

# apply after review; originals are verified and backed up first
zhin migrate instances --apply

# if you used a custom lifecycle file, pass it explicitly
zhin migrate instances --lifecycle-file /absolute/path/plugin-lifecycle.json
```

The tool converts only projects whose identity and meaning can be preserved. It does not upgrade dependencies, load third-party plugin entries, or treat a successful file conversion as platform or business verification. Inline schemas, token resources and real assembly are checked at the next startup.

If a multi-file conversion is interrupted, inspect the reported journal, then continue or roll back:

```bash
zhin migrate instances --recover continue
zhin migrate instances --recover rollback
```

An unfinished migration blocks startup so half-written state is never mixed. The tool detects a known `.zhin.pid`, but cannot prove every manually started foreground process has stopped; confirm the Bot is stopped before `--apply`. If a file was changed by someone else, recovery refuses to overwrite it; keep both versions and reconcile manually.

## Manual migration

Stop the Bot, use a CLI that includes this change, and back up `package.json`, the main config and the old lifecycle file first. Then move:

| Old location | New location |
| --- | --- |
| `{ package, instanceKey }` in `package.json#zhin.plugins` | main config `plugins.<instanceKey>: package` |
| business options under main config `plugins.<instanceKey>` | top-level `<instanceKey>` in the main config |
| instance names in the lifecycle `disabled` list | main config `disable_plugins` |

Then remove the old mounts from `package.json#zhin.plugins` and retire the old disabled state. **Keep npm dependencies and package-level contracts such as `zhin.features`, `entry` and `engine`.** Keep `${VAR}` environment references, business values, original instance names and persisted data.

## Cases that cannot be converted automatically

- **Instance names colliding with Host or structural keys**: pick a new name and migrate the persistence owner explicitly. Renaming changes `root/<instance>`, so it is not a display-only change.
- **Existing nested plugin trees**: flat declarations only support direct Root instances in this version. Flattening changes the parent scope, package resolution and persistent identity, so adjust dependencies and resource contracts by hand and verify.
- **Per-mount optional**: the new format has no such switch. Decide whether it becomes a required enabled package or an installed but disabled instance.
- **Orphan business blocks, stale disabled entries, duplicate keys or complex YAML references**: resolve the ambiguity first; the tool never guesses package names or deletes user data.

After migrating, run `zhin config check`, start with your usual process entry, and check instance and Endpoint state in Console.
