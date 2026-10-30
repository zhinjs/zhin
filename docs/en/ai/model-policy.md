---
outline: deep
---

# Personal Sessions and model policy

A personal AI Session belongs to one authenticated person in one concrete private chat, group or channel. Changing its chat preset preserves history. Restoring inheritance removes the Session selection. A running turn retains its exact model, connection revision and resource lease.

The resolution chain is `connection → model definition → preset → scope policy → immutable invocation`. Agent definitions continue to own Tool, MCP and task authority independently.

## Deployment and migration

Existing `ai.providers` and Agent `provider/model` bindings are compiled at the Host boundary into the same catalog and policy. A missing bound model can use only an explicitly configured `defaultModel` or `models[0]`; otherwise migration fails without discovery or a guessed model.

Deployment catalogs contain only connections owned by the current Host; personal connections come from the separate personal snapshot. The primary Agent, IM, system tasks and default standalone callers share `modelPolicy.defaults.chat`. `agents.zhin` may contain authority/display metadata only, while other roles require a preset. Authored references remain validated even when the effective primary default differs.

The explicit form uses `ai.modelCatalog` with `connections/models/presets`, plus `ai.modelPolicy.defaults.chat`. Dictionary keys must equal entry IDs and all references must exist. See the [complete configuration example](../../ai/model-policy.md#部署配置) and [generated configuration reference](../configuration/generated.md). Host owner IDs are derived from the absolute project directory; moving the project changes that identity.

Connections contain `id/ownerId/revision/sdk`, optional `baseUrl`, and an opaque `secretRef`. Host `env://NAME` references are resolved only by execution. Personal keys use the Host-private credential vault. Increment the revision when changing a connection; conflicting contents for the same revision are rejected. Plaintext keys, authentication headers and arbitrary SDK parameters cannot appear in catalog entries or scope overrides. Existing Host Provider parameters remain private factory data.

When omitted, `defaults.summary` is normalized to deployment `defaults.chat`; personal or other chat overrides never change it. A gradual migration may retain complete legacy perception settings and their Provider aliases: the compiler adds that configured chain to the explicit catalog, rejects conflicting IDs, and uses it only when no explicit perception default overrides it.

A preset contains only `id/modelId`. Use `agents.<name>.preset` for an explicit role; do not combine it with legacy `provider/model`. Optional positive `contextWindow/maxOutputTokens` model metadata is separate from scope policy. Capabilities are validated when requested; missing declarations do not count as support.

## Scope vocabulary

| Scope | Allowed purpose references |
| --- | --- |
| Default | chat, perception, summary |
| Adapter | chat, perception |
| Endpoint | chat, perception |
| Scene | chat |
| Personal Session | chat preset or inherit |

Overrides select complete presets and never deep-merge permissions, secrets or SDK options. Missing, unauthorized or incompatible explicit selections fail instead of falling back. System tasks without an IM origin use defaults, never a previous sender's personal selection. Explicit role presets remain independent of personal chat overrides. Configured legacy perception fallback chains retain their order; no new chain is added. All chat turns, including legacy configuration and personal selections, stay on the selected model. Existing same-model retries remain; exhaustion reports the failure without switching models or Providers. Native structured decisions remain under `ai.decisions`.

Administrators map authenticated Console principals to exact IM owners through `ai.personalPrincipals`; a client cannot assert another owner. Personal connections require public HTTPS services with per-hop DNS checks and same-origin HTTPS redirects only. Credential query parameters must use the encrypted API Key field; ordinary query parameters remain supported. Host-authored local services retain their existing access. Creating a connection or selecting a model does not implicitly call a provider.

Run `zhin config check` before migration. `--fix` preserves the explicit form and does not redistribute shared history or create personal connections. Local tests, deployment and real-provider acceptance remain separate evidence. See [ADR 0045](../../adr/0045-personal-session-model-policy.md).

Personal Console tokens use `http.tokens` entries with `scope: user` and a stable `principalId` matching `ai.personalPrincipals`. An unbound primary/full token is not a personal identity. Use the real Host project path and canonical Adapter entry id rather than display names.

Encrypted files live in `.zhin/personal-model-credentials`. Back up its master `root-key.json`, ciphertext and database references together. Unknown metadata commit outcomes retain the new ciphertext without automatic retry or deletion. Database changes add nullable source dimensions and an index; they do not rewrite legacy shared history. Rollback preserves these columns, personal records and the vault. A project move changes the Host identity and does not automatically authorize old personal bindings.
