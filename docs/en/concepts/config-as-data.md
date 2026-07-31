# Config as Data

Change a port on the Console -- either the entire change takes effect, or it rolls back completely. The `zhin.config.yml` on disk will never be left in a half-written state. This is possible because zhin.js configuration is not code but a data document strictly constrained by schemas: each package declares its configuration contract via `schema.json`, the runtime validates the entire document against the effective schema composed from the plugin tree using Ajv strict mode, and then projects the configuration to each plugin by owner. Configuration changes go through transactions with no intermediate state.

## Document Structure

```yaml
# Root Plugin configuration (corresponding to the Root package's schema.json)
plugin:
  terminal:
    interactive: true

# Child plugin configuration, namespaced by instanceKey
plugins:
  sandbox:
    endpoints:
      - name: full-bot-sandbox
        context: sandbox
        owner: local-user
  napcat:
    connection: ws
    endpoints:
      - name: full-bot-napcat
        url: ${ONEBOT11_WS_URL}          # Environment variable interpolation
        access_token: ${ONEBOT11_ACCESS_TOKEN}
```

The effective schema is composed by `ConfigComposer` (`packages/im/runtime/src/config-composer.ts`) from the plugin tree:

- `plugin` -- the Root Plugin's own schema;
- `plugins.<instanceKey>` -- each child plugin's schema, with nested child plugins recursively attached under the parent schema's properties;
- Host-level keys `http` / `database` / `ai` / `mcp` / `a2a` / `speech` / `htmlRenderer` / `assistant` / `collaboration` / `log_level` -- consumed by the CLI's Root installer and **not** included in any plugin's configuration view;
- Top-level structure uses `additionalProperties: false`: misspelling a key name (e.g., typing `plugn` instead of `plugin`) will produce an immediate error rather than being silently ignored.

## schema.json: Declarative Contract

The `schema.json` in each package's root directory is its configuration contract. `examples/minimal-bot/schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "commandPrefix": { "type": "string", "default": "/" },
    "terminal": {
      "type": "object",
      "additionalProperties": false,
      "default": {},
      "properties": {
        "interactive": { "type": "boolean", "default": true },
        "prompt": { "type": "string", "default": "zhin> " }
      }
    }
  }
}
```

There are a few constraints to be aware of when writing schemas. The root must be an object schema; packages without a schema.json are treated as an empty object. Purely compositional schemas at the root level (`anyOf`/`oneOf`/`allOf`/`$ref` without `properties`) are not allowed -- they can pass validation, but cause the config projection to silently become empty, so they are explicitly rejected. Validation uses Ajv 2020 with `strict: true`, `allErrors: true`, `useDefaults: true`: `default` values in the schema are backfilled into the document during validation. Validation failure throws `ConfigValidationError`, with error messages indicating the specific path and offending keys (`additionalProperty: xxx`) or valid enum values. Additionally, if a child plugin's `instanceKey` collides with a property name in the parent plugin's own schema, a `ConfigSchemaCollisionError` is thrown.

## ConfigView: Projection by Owner

Plugins do **not** receive their entire subtree from the document (which also contains their descendants). `ConfigComposer` uses `pickOwnFields` to select top-level properties according to each package's own schema, freezes the result, and provides it as the plugin's `ConfigView`:

```ts
// PluginSetupContext.config
context.config.get(); // Contains only fields declared in this plugin's schema
```

Environment variable interpolation (`${VAR}`) is expanded during projection; unset variables expand to empty strings. Secrets should always use environment variables and never be written directly in YAML.

## Adapter Configuration Model: Top-level Shared + `endpoints[i]`

Multi-account adapters (a single plugin instance connected to multiple platform connections) use the `endpoints` array. The expansion logic is implemented in `AdapterIndex` (`packages/im/adapter/src/adapter-index.ts`):

```yaml
plugins:
  icqq:
    commandPrefix: "/"          # Top-level: shared by all endpoints
    endpoints:
      - name: bot-a
        uin: ${ICQQ_UIN_A}
      - name: bot-b
        uin: ${ICQQ_UIN_B}
        commandPrefix: ""       # Per-entry override of top-level
```

- Each entry's effective configuration = instance configuration (without the `endpoints` key) **merged with** the entry's own fields; `name` is required.
- After expansion, each endpoint is an independent record. The capability ID is in the form `<slot>~<name>`, and Console and message chains address by name.
- Entries missing `name`, containing `~` or `\0` in the name, or having duplicate names are discarded with a warning; when all entries are invalid, it falls back to a single endpoint.
- When `endpoints` is empty or absent, a single endpoint is created from the instance configuration.

### commandPrefix

The command prefix is resolved by default based on the adapter instance that owns the message (`defaultCommandPrefixResolver`):

1. If the message carries `metadata.endpoint` and a matching `endpoints[i]` exists in configuration, use that entry's `commandPrefix`;
2. Otherwise, use the instance's top-level `commandPrefix`;
3. If neither exists, use `''` (no prefix -- any text is attempted as a command match).

## Configuration Document Transactions and Rollback

Runtime configuration changes (Console UI, `patchConfig` API) do not modify the file directly. Instead, they go through a two-phase transaction with the `ConfigDocumentPort` interface:

```ts
interface ConfigDocumentPort {
  read(): Promise<ConfigDocumentSnapshot>;           // Document + revision (content sha256)
  prepare(current, patches): Promise<PreparedConfigDocument>; // Candidate document, lazy at this stage
}
interface PreparedConfigDocument {
  commit(): Promise<ConfigDocumentSnapshot>;
  rollback(): Promise<void>;
}
```

Key implementation details of `YamlConfigDocument` (`@zhin.js/config-yaml`):

- **Optimistic concurrency**: Both `prepare` and `commit` re-read the file and verify the revision; if the file was modified externally after reading, a `ConfigDocumentConflictError` is thrown.
- **Format preservation**: Patches are applied to the YAML AST before stringifying, preserving comments and indentation style (including CRLF); numeric segments in paths address array elements (`endpoints.0.url`), and dangerous segments like `__proto__` are rejected.
- **Atomic write to disk**: `commit` first writes to a temporary file then uses `rename` to replace, preserving original file permissions.
- **Consistency**: If the candidate document diverges from the runtime-validated candidate, a `ConfigDocumentDivergenceError` is thrown -- preferring failure over writing divergent configuration.

Transactions are woven into generation handoff: `RootRuntime.patchConfig` first performs a shadow prepare (see [Generation and Lifecycle](./generation-lifecycle.md)), and the file commit happens after the new generation's resources are activated; if the handoff fails, the rollback order is reversed -- first restore the file, then deactivate the shadow generation. If any step fails, neither the `zhin.config.yml` on disk nor the in-memory runtime will be left in a half-updated state.

Direct external editing of the configuration file is also supported: the config file itself is watched, and external modifications trigger a full reload using the disk content as the source of truth.
