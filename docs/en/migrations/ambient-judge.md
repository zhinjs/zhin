---
title: 'Upgrading: Interjection Judge Merge'
description: ADR 0066 upgrade notes — the ambient purpose and the ambient decision become one interjection judge, purposes.ambient; the automatic migration table, the behaviour change, the revert command and the deprecation window
---

# Upgrading: interjection judge merge (ADR 0066)

From this version, whether the bot chimes in when nobody addressed it in a group is decided by one setting, the interjection judge `purposes.ambient` ([ADR 0066](../../adr/0066-ambient-judge-merge.md)). The former ambient language purpose and the ambient decision become this one item: one model choice (a language or a decision model), one fallback chain that may mix both kinds, an optional compared model, one threshold and one "watch only" switch. See [AI configuration: interjection judge](../ai/index.md#interjection-judge).

## Automatic migration

The first time the instance loads the model configuration after the upgrade, it migrates once: it computes `purposes.ambient` by the table below, removes the old fields and writes both back in one transaction, keeping the complete previous purposes for a revert. `ai.trigger.ambient.minConfidence` / `mode` of `zhin.config.yml` are read once at that time (the file is not changed).

`L` = the former ambient language model and its fallbacks, `D` = the former ambient decision, `T` = `ai.trigger.ambient` of `zhin.config.yml`:

| Old configuration | `profile` | `fallbacks` | `compare` | `minConfidence` | `mode` | `timeoutMs` |
|---|---|---|---|---|---|---|
| no `D`, or `D` off | `L`'s primary (none: follows chat) | `L`'s fallbacks | — | `T.minConfidence` | `T.mode` | — |
| `D` active | `D`'s Profile | **`L`'s primary first**, then `L`'s fallbacks (empty when `L` followed chat) | — | the larger of the two old thresholds | `T.mode` | `D.timeoutMs` |
| `D` shadow | `L`'s primary | `L`'s fallbacks | `D`'s Profile | `T.minConfidence` | `T.mode` | `D.timeoutMs` |

- **The one behaviour change**: a deployment with an active ambient decision and a separate ambient language model now hands a failed decision (timeout, network error, 5xx, invalid answer, exhausted quota …) to that language model; before, the bot just stayed quiet. Remove it from the fallback chain if you do not want that. A language judge that followed chat does not add the chat model as a fallback.
- The threshold is the larger of the two old ones, exactly the effect the two stacked thresholds had: no extra interjections after the migration.
- "Shadow" becomes the compared model: the deciding judge and the behaviour stay the same; its `minConfidence` only gated the shadow record and is dropped. Agreement is now counted as "would it speak after the threshold", so the numbers differ from the old ones.
- An "off" decision Profile was never called and is not migrated (the Profile itself stays).

The first `zhin doctor` after the migration shows one record: what was migrated, where each value came from, what was dropped and why, when, and the revert command; later runs show it only with `zhin doctor --verbose`. The instance log has one `ambient_judge_migrated` line.

A failed migration (for example a referenced Profile that is no longer the Host's, or three write conflicts in a row) writes nothing: the instance converts by the same table in memory and behaves exactly as after a successful migration; the log has `ambient_judge_migration_failed` and `zhin doctor` reports an error with the path to fix. The next load tries again.

## Revert and downgrade

Older versions cannot read a model configuration with `purposes.ambient`. **Before a downgrade, run:**

```bash
zhin ai purposes revert ambient-judge
```

It restores the previous form of the interjection judge (other purposes stay as they are) only while `purposes.ambient` is unchanged since the migration; otherwise it refuses and says why. `ai.trigger.ambient.minConfidence` / `mode` read by the migration and removed since by `zhin doctor --fix` are written back to the configuration file first; when that is impossible nothing is reverted and the command lists what to add back by hand. While it runs the instance does not take the written-back values as new writes. The command first works out what the configuration file must say and writes it before reverting; a value that differs from what this version runs with is overwritten (and listed); when the file cannot be written nothing is reverted, and a refused revert puts the file back as it was. A `purposes.ambient` that existed before the migration (for example imported from `ai.plan.yml` on the first start) is converted back to the old form, its threshold and watch-only mode written to `ai.trigger.ambient`; what the old form cannot express is listed, and then the command does not say a downgrade is safe: handle those items by hand first. After a revert the current version keeps converting the old form in memory (same behaviour) and does not migrate again by itself; saving the interjection judge once in Console writes the new form again. The migration record always keeps the previous configuration for a manual restore.

## Deprecation window

In this minor and the next one:

- `purposes.decisions.ambient` in an import (`ai.plan.yml`, Console, scripts) is still accepted, converted by the table together with `purposes.ambient` of the same import, and the result carries a warning; `mode: off` or `null` undoes the decision model the old way (the former ambient language model comes back, and the compared model of a former shadow goes). The string form `purposes.ambient: <profile>` replaces only the language model and keeps 'watch only', the compared model and the threshold. Afterwards it fails with `invalid-plan` (path `purposes.decisions.ambient`). Exports write the new shape only.
- `ai.trigger.ambient.minConfidence` / `mode` of `zhin.config.yml` are read once by the migration and no longer apply by themselves afterwards. A later write of these keys (for example the 'watch only' switch of an older Console) is converted into the interjection judge on the next load and logged as `ambient_trigger_write_converted`, never silently lost. `zhin doctor` reports them as no longer applied, and `--fix` removes them (other keys and comments stay), only when the running instance's migration record confirms they were migrated; with no running instance, before the migration, or after a failed or reverted one they still apply: a warning, and `--fix` leaves them. After the window migrated keys are reported as errors; startup still only warns.
- Self-changes and `config set` in chat can no longer write these two keys.

Legacy stored fields are always migrated automatically; that does not end with the window.
