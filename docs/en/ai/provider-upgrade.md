---
title: "AI Provider Target Interface Upgrade"
description: "Version boundaries between old and new plugins, explicit model migration, and the recovery procedure."
---

# AI Provider target interface upgrade

This is a complete interface replacement that, as confirmed for the project, still ships as patch releases. Old and new configuration never run side by side in one process; before upgrading, keep backups of the database, the startup configuration, and the Host's local encryption master key. The "minimum version" column below is published on npm; each package's CHANGELOG is the authority for actual versions.

## Plugin version boundaries

| Package | Last version supporting the old interface | Minimum version for the target interface |
| --- | --- | --- |
| `@zhin.js/ai` | `1.1.50` | `1.1.51` |
| `@zhin.js/ai-provider` | No such target-interface package | `1.0.1` |
| `@zhin.js/agent` | `1.1.46` | `1.1.47` |
| `@zhin.js/cli` | `1.1.27` | `1.1.28` |
| `@zhin.js/runtime` | `1.1.17` | `1.1.18` |
| `@zhin.js/core` | `1.1.55` | `1.1.56` |
| `@zhin.js/feature-kit` | `1.1.11` | `1.1.12` |
| `@zhin.js/command` | `1.1.13` | `1.1.14` |
| `@zhin.js/tool` | `1.1.14` | `1.1.15` |
| `@zhin.js/component` | `1.1.12` | `1.1.13` |
| `@zhin.js/handler` | `1.1.11` | `1.1.12` |
| `@zhin.js/middleware` | `1.1.12` | `1.1.13` |
| `@zhin.js/schedule-feature` | `1.1.11` | `1.1.12` |
| `@zhin.js/service-typesafe` | `1.0.15` | `1.0.16` |
| `@zhin.js/scaffold-wizard` | `1.1.14` | `1.1.15` |
| `create-zhin-app` | `1.1.15` | `1.1.16` |
| `@zhin.js/client` | `1.1.23` | `1.1.24` |
| `@zhin.js/database` | `1.1.5` | `1.1.6` |
| `@zhin.js/host-http` | `1.1.13` | `1.1.14` |
| `@zhin.js/a2a` | `1.1.22` | `1.1.23` |

A new plugin declares the minimum versions of the matching set it uses and does not mix in the execution context of the old FeatureKit / Command / Tool. A plugin that uses the old Provider, Catalog, runtime override, or positional-argument interfaces should cap its dependency ranges at the old versions in the table and raise them only after migrating. Each package's CHANGELOG and release notes are the authority for what was actually published.

## Configuration migration

The old `ai.providers`, `modelCatalog`, `modelPolicy`, `defaultProvider`, `agents.<name>.provider/model/preset`, `multimodal.perception.provider/model/fallbacks`, `trigger.ambient.judge`, and global `imageGeneration` can no longer be the startup authority for model selection. When the CLI detects these old fields it starts an authenticated migration management mode: the old model execution entry is disabled, and the original files and data are kept. You do not have to delete the old configuration by hand before opening Console. Other configuration errors are still reported explicitly and never count as a successful migration.

The migration preview reads only the metadata of the selected sources and writes `migration.json`: its `units` hold each owner's `plan`, the explicit mappings, and the items still to be filled in, and a sealed proof binds it to the original sources. It is not an ordinary `ai.plan.yml`, and a standalone plan file cannot be passed to `--apply`. The preview does not log in, call a model, load `.env`, decrypt the old vault, or change the database. Reading the old startup text may meet old inline fields; the public preview keeps only a locator and never prints the plaintext, and the private source proof is sealed by the Host. SDK namespace parameters, unclear model capabilities, parent channel / thread identity, and multi-candidate ambient models are never guessed; fill in explicit mappings and preview again.

Run inside the project directory (file names are examples and contain no secrets):

```bash
zhin migrate inference --mapping inference-mapping.json --output migration.json
# Review the blocked items; after filling in mappings, write to a new file — the original preview is not overwritten.
# Stop the Bot and back up the startup files, the database, and the Host local master key, then:
zhin migrate inference --apply migration.json --maintenance --backup-confirmed
# Add --with-credentials to apply only when the preview lists old encrypted credentials and you agree to re-seal them.
zhin migrate inference --finalize migration.json --maintenance --backup-confirmed
```

The preview may omit `--mapping` to see what still needs filling in. Old metadata from a non-SQLite database is supplied explicitly with `--state-snapshot`, and `--database-config` provides a separate database connection file when one is needed; both are used only to produce the preview. Apply and finalize use the same reviewed file and accept no other source or mapping. Private backups and `migration.json` should be kept by the local administrator and never committed publicly. The database commit and the startup file switch are journaled as separate steps; normal startup resumes only after finalize completes. See the [offline migration entry](https://github.com/zhinjs/zhin/blob/main/docs/plans/inference-migration-cli-contract.md) (Chinese).

Existing role settings such as permissions, MCP, and nicknames still belong to the Agent startup configuration and are not mixed into Profiles. Generation parameters belong to the Profile; summaries, approval, and ambient listening no longer add their own implicit temperature / output limits. When the generic SDK has no explicit limit it keeps the value declared by the model catalog or the existing effective default of 8192, and the Codex protocol has no such field; this change does not remove the default budget globally. Compatibility protocol and Google cache settings belong to the Service. Old API key / vault records are decrypted and re-sealed by the Host inside a separately authorized private migration boundary; the public preview contains only source locators. The source revision, the selected scope, the complete preview fingerprint, and the receipt must all be verified at commit time.

An old preset selection on a personal Session must be mapped by an administrator to a real target Profile identity and is never inherited through a same-name alias; a Session that inherited the default keeps `inherit`. After an Account is deleted and recreated, or its real identity changes, the old selection cannot bind to the new incarnation automatically.

### Fix a migrated environment-default key

A single complete `${NAME:-default}` / `${NAME:=default}` is transferred as a private encrypted source; the offline preview and apply do not read the environment or expand the default. A plain `${NAME}` still becomes `env://NAME`. Transferring a private source still requires `--with-credentials` explicitly.

If an older version stored the template's literal text as the API key, the administrator selects the **original Account** in Console, opens "Set API key", enters the complete expression from their original configuration or backup, reviews the preview, and confirms. This entry repairs only the selected Account and does not scan other credentials; the proven-wrong template material fingerprint is cleared only when the current key equals the submitted valid template exactly and the revision is unchanged. An existing real account subject is not cleared; any other change of real material identity still requires explicit re-authorization or replacement, and template input cannot be used to reset an identity. The preview never echoes the default value; do not paste a real expression into an issue or a log.

### Manual migration for the official TypeSafe plugin

TypeSafe is not part of the headless built-in catalog, so the offline compiler marks the old `ai.decisions` as needing explicit handling and never runs plugin JavaScript for a preview. Enter a maintenance window first and back up the original configuration, the database, and the master key. Keep the TypeSafe plugin declaration, follow the [TypeSafe upgrade steps](https://github.com/zhinjs/zhin/blob/main/plugins/services/typesafe/README.md) to remove its retired secret/model/enabled plugin configuration and the old `ai.decisions` routes, then start the new Host management page. Using the exact `typesafe` Driver the plugin actually registers, create an API key Account, a `typesafe-system-one` / `decision` model, and a Profile, then rebuild the six decision purposes one by one. The native ID keeps the actual value from the old configuration; each purpose's original mode, threshold, and timeout must be preserved explicitly and is never enabled automatically by the upgrade.

Do not resume automated business before the new purposes are configured; old Session selections need a separate explicit binding. To recover, first check the journal and any later writes to a shared database as described in the Recovery section below, then use the matching original package versions, configuration, selected data, and master key. Never overwrite new writes from another Root, and never let the old program read the new graph and guess at compatibility. Both the new graph and the old source text are kept until confirmed and are not deleted automatically.

### Restore only old Sessions onto an existing Profile

First create the Profile for the original owner through normal Console use; a third-party Driver is also registered by its plugin in the normal way, and the migration tool does not run it. Use `zhin migrate inference --output legacy-sources.json` to see the original Session's `identity.key` and its physical `sourceRevision` (not the numeric revision inside the Session state), then write an explicit mapping:

```json
{
  "version": 1,
  "sessions": {
    "personal-session:v1:<original full key>": {
      "sourceRevision": "<source revision from the preview>",
      "selection": {
        "kind": "profile",
        "profile": {
          "id": "<existing Profile ID>",
          "rootId": "/absolute/project/root",
          "accountId": "<existing Account ID>",
          "accountIncarnation": "<current account incarnation>",
          "kind": "language"
        }
      }
    }
  }
}
```

To restore the default choice, use `"selection": { "kind": "inherit" }` explicitly; a missing field or a same-name old preset is never used as a guess.

```bash
zhin migrate inference --sessions-only --mapping session-bindings.json --output session-preview.json
zhin migrate inference --apply session-preview.json --maintenance --backup-confirmed
```

A SQLite preview reads the database read-only and validates targets ahead of time. A non-SQLite database uses the explicit source snapshot from `--state-snapshot`, is marked `targetValidation: deferred-until-apply`, and does not connect to the remote. For every database, before the first Session CAS of apply, all targets, the static owner, the complete Account identity, and the original source revision are verified again; if any check fails, no other selected Session is written. This mode does not switch the startup file, read model credentials, load Drivers, or delete the old catalog. It stores only the Profile identity; parameters and the native model still follow that Profile on the next turn.

## Author interfaces

- The low-level `ContextManager` receives a caller-owned summary operation through `setSummaryCompletion({ system, prompt, signal } => Promise<string>)`; it no longer installs a Provider or hides sampling parameters.
- `SdkProviderAdapter`, `createSdkProviderAdapter`, `sdkEntryFromProvider`, and `@zhin.js/ai/model-catalog` are removed. A Driver is a declaration / protocol implementation; the Host owns configuration, credentials, and the call lifecycle.
- Ordinary commands and tools call through the official `context.use(aiInferenceClientToken)`; they do not keep a process-level client and do not fill in the principal / owner themselves.
- `createCapabilityContext` takes a named options object. `ToolIndex.execute` takes `{ requester, name, input, invocation, snapshot?, operation? }`; the operation must come from the Host's real entry and can never be placed in user JSON metadata.
- Constructing an Agent no longer requires a Provider. A standalone call borrows a `ModelExecutionScope` explicitly, and whoever acquired the scope releases it. A real generation lease is passed in from the official task entry and cannot be filled in from the latest global object.
- `ProfileSelection` stores a non-reusable identity; each turn resolves that identity's current parameters. A short-lived `ProfileRef` pins the revision for this call and cannot be stored as a long-lived Session selection. The native model of one Profile can be replaced in place; existing Sessions follow on the next turn and calls in flight are unchanged. After switching Accounts, an old Session's accountId/incarnation pin becomes invalid and is not inherited across accounts automatically.

The database type entries are isolated: the default entry of `@zhin.js/database` keeps the neutral database / model / transaction API plus Memory and SQLite, and the default declarations of Core, Agent, and Zhin no longer pull in unselected external dialects. SQLite users do not need to install MySQL, PostgreSQL, MongoDB, or Redis drivers or declarations. TypeScript authors who use an external dialect import the class and the full vendor configuration type from `@zhin.js/database/dialects/mysql`, `@zhin.js/database/dialects/pg`, `@zhin.js/database/dialects/mongodb`, or `@zhin.js/database/dialects/redis`.

TypeScript consumers of PostgreSQL also need to install the `@types/pg` that matches `pg`; JavaScript-only users need only `pg`. The default entry still registers the six factories automatically, `Registry.create()` stays synchronous, and the selected client is loaded only on connect. Import examples are in the [Database TypeScript entry points](https://github.com/zhinjs/zhin/blob/main/basic/database/README.md#typescript-entry-points); the isolation contract and real archive verification are in [optional database dialect type isolation](https://github.com/zhinjs/zhin/blob/main/docs/plans/database-optional-dialect-types.md) (Chinese).

## Recovery

When the result of a commit is unknown, query the receipt with the original mutationId first; never retry with a new ID. A failure or conflict is never reported as saved. Before restoring old-version code, check the selected records against the migration journal. Restore the whole database and the matching master key backup only within the same maintenance window and only when no other Root has written to a shared database since; otherwise restore by manually checking the before/after records of the selected units / Sessions, without overwriting new writes from another Root. Do not let an old version read the new target graph and guess at compatibility. External token rotation cannot be undone from a local backup. The original migration sources are kept until the administrator confirms that recovery is complete and are not deleted automatically.

Local mock / SQLite / HTTP and build verification prove only the code contract. Real subscription accounts, vendor behavior, cost, and deployment results must be accepted after separate authorization.
