---
title: "Upgrading: feature overrides move to the database"
description: Per adapter / account feature overrides (overrides under a plugin block in the configuration file) move to the project database table feature_overrides — automatic migration steps, backup and record, retries, the error afterwards and what to use instead
---

# Upgrading: feature overrides move to the database (ADR 0057 §2)

Per adapter and per account feature overrides used to live under `overrides` in a plugin block of `zhin.config.yml`. From this release they live in the project database table `feature_overrides`, like conversation overrides ([ADR 0057](../../adr/0057-config-storage.md), Chinese):

| Level | Before | Now |
| --- | --- | --- |
| Global | The plugin's own block; `disable_plugins` | Unchanged |
| Adapter | `<plugin>.overrides.adapters.<alias>` | `feature_overrides`, `level = 'adapter'` |
| Account | `<plugin>.overrides.endpoints."<alias>/<account id>"` | `feature_overrides`, `level = 'endpoint'` |
| Conversation | `feature_conversation_overrides` | `feature_overrides`, `level = 'conversation'` |

Resolution order, locks and field allowlists are unchanged ([Features and layered configuration](../console/features.md#resolution)). Changes apply at once without a restart; other instances sharing the database see them within 5 seconds.

## 1. Automatic migration

On the first start with this release the instance:

1. Finds `overrides` under every plugin block (nested child plugin blocks included) before it reads the configuration. A value holding a `${…}` or `env://` reference stops startup without changing any file: stored overrides are never environment-expanded, so replace the reference with a literal value or move the field to the plugin's global block first;
2. Once the database is loaded, writes every entry to `feature_overrides` (`updated_by` is `migration:<source path>`). An override the database already has for the same plugin and key is kept. Entries holding only `enabled: true` are not imported (they never had an effect);
3. Records the migration in `.zhin/migrations/feature-overrides.json` (status `imported`);
4. After the instance started, copies the configuration file unchanged to `.zhin/backups/feature-overrides-<time>/`, then removes those `overrides` blocks: an atomic write that checks the file has not changed since step 1;
5. Marks the record `done`, with the backup path.

If any step fails the configuration file stays as it was and the next start retries; entries already in the database are not imported twice. If the file was changed elsewhere right before step 4 (revision mismatch), the blocks are removed on the next start as well.

While the status is `imported` (imported, blocks not removed yet), a row whose last writer is still the migration (`updated_by` starting with `migration:`, kept by every resync from the file even as the revision grows) stays owned by the configuration file: file edits overwrite it and removed entries are removed. A row changed elsewhere (the Console records its actor) keeps the stored value, with a warning per entry.

Once the migration is `done`, configuration updates that write an `overrides` block at the top level or in a real child Plugin are refused; to refuse at update time rather than at the next start, an update that adds a nested override-shaped `overrides` block is refused too (fields that were already there and judged plugin settings at start are not affected); child Plugins are judged by the Plugin tree in service.

Conversation overrides used to live in `feature_conversation_overrides`. On the first load they are copied to `feature_overrides` with `level = 'conversation'` (skipped when the new table already has that key). The old table is left in place and never written again; drop it by hand once you are satisfied.

Without a relational database (MongoDB, Redis or memory dialects) the file's overrides take effect in memory only, the file is left alone and the record stays `pending` (with `memoryOnlyAt`) until sqlite / mysql / pg is configured. Every override write from the Console or chat (conversation level included) is refused meanwhile (Console 503 `feature-overrides-unpersisted`, chat answers "Not saved"), so nothing is reported as saved and then lost on restart.

## 2. After the migration

Once the migration is done (and in projects that never had `overrides`), an `overrides` block under a plugin in the configuration file stops startup (`LEGACY_FEATURE_OVERRIDES`), and the same block written while running (Console configuration form, file reload) is refused. Use instead:

- The Console: the **Features** tab of the global / adapter / account / conversation object pages, or the feature matrix (`feature.set-override` / `feature.set-enabled` / `feature.remove-override`);
- Chat: with `features.selfService.enabled`, `feature set <plugin> <field> <value> endpoint|adapter` and `feature enable|disable <plugin> endpoint|adapter` (`功能 设置 …` / `功能 开启|关闭 …`).

To carry overrides to a new project, set them again in that project's Console for now; export comes later (ADR 0057 §3).

## 3. What changes for plugins and integrations

- `context.configFor(target)` / `context.isEnabledFor(target)` are unchanged and read the stored overrides.
- Code that read `overrides` from the configuration document to compute effective values no longer sees these levels; use `configFor` / `isEnabledFor`.
- `feature.*` RPC request and response shapes are unchanged. At the adapter / account levels `revision` is now the stored row's revision (`'0'` without an override); send it back as `expectedRevision`. Older Console builds that send the configuration revision can still write while it is current.
