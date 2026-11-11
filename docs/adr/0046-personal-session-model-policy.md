---
sidebar: false
---

# ADR 0046: Personal Session model policy

Status: Partially Superseded — Personal Session Boundary Implemented (@zhin.js/agent/personal-session); Model Catalog & Model Policy Superseded by ADR 0047 (@zhin.js/ai/provider).

> [!IMPORTANT]
> **Status & Supersession Boundary:**
> - **Active:** The **Personal Session** contract (`PersonalSessionTask`, `PersonalSessionPolicy`, `preparePersonalSessionTurn` in `@zhin.js/agent/personal-session`) and the **Adapter Session Runtime** contract ([Adapter、Endpoint 与消息 Session 实施方案](https://github.com/zhinjs/zhin/blob/main/docs/plans/adapter-session-runtime-refactor.md)) remain active.
> - **Superseded:** The **Model Catalog and Policy** (`@zhin.js/ai/model-catalog`, `@zhin.js/agent/model-policy`, and the `connection -> model definition -> invocation preset` chain) described in the second half of this ADR was superseded and retired by [ADR 0047](./0047-ai-provider-subscriptions-and-decision-models.md) in favor of `@zhin.js/ai/provider` (`Service -> Account -> Model Profile -> Purpose Policy`).

The approved in-process Adapter/Endpoint and typed message Session evolution is specified in [Adapter、Endpoint 与消息 Session 实施方案](https://github.com/zhinjs/zhin/blob/main/docs/plans/adapter-session-runtime-refactor.md). Worker isolation and a separate public AdapterController are superseded by the Adapter base class plan.

## Confirmed requirements

A personal AI Session belongs to one authenticated person in one concrete IM conversation. Its identity includes the Host, adapter entry, endpoint account instance, conversation kind/id, parent, thread and subject. Another person's settings, cancellation and personal transcript are not its state. Public conversation events remain references with independent consumer cursors. Existing shared-session records remain intact; this change does not redistribute legacy history.

A user may own a model account / profile and select a chat profile at any time. Selection applies to the next turn; an admitted turn owns an immutable execution binding until completion/cancellation. Restoring inheritance removes the Session selection. A model change preserves canonical history and never grants tools or permissions.

## Model Catalog and Policy (Superseded by ADR 0047)

> **Superseded by [ADR 0047](./0047-ai-provider-subscriptions-and-decision-models.md):** The `connection -> model definition -> invocation preset -> scope policy -> resolved invocation -> leased runtime` chain (`@zhin.js/ai/model-catalog` and `@zhin.js/agent/model-policy`) has been retired and replaced by `@zhin.js/ai/provider` (`Provider Driver -> Service -> Account -> Model Profile -> Purpose Policy -> ExecutionBinding`). Only `@zhin.js/agent/personal-session` (canonical personal address, authenticated ownership, chat selection and optimistic concurrency) remains active.

Historical chain recorded at ADR 0046 time:
`connection -> model definition -> invocation preset -> scope policy -> resolved invocation -> leased runtime`

- `@zhin.js/ai/model-catalog` *(retired by ADR 0047, replaced by `@zhin.js/ai/provider`)*: transport-neutral contracts, reference/capability validation, ownership checks and revision-aware runtime leases. No IM identity, files, HTTP routes or plaintext keys in catalog values.
- `@zhin.js/agent/model-policy` *(retired by ADR 0047, replaced by `@zhin.js/ai/provider` Purpose Policy)*: the only compiler for scope declarations and resolver for model-purpose references. No credential IO, arbitrary deep merge or implicit fallback.
- `@zhin.js/agent/personal-session` *(active)*: canonical personal address, authenticated ownership, chat selection and optimistic concurrency. Repository ports separate policy from persistence.
- Agent runtime: resolve a turn's permitted references once, acquire exact execution bindings and release in `finally`. Agent definitions continue to own MCP/tool/task authority independently.
- CLI composition: persistent repositories, encrypted credential vault, trusted IM/Console identity projection and provider network transport. Resources belong to the Root/operation lifecycle, not module singletons.
- Console: personal model management and Session selection consume the same contracts; server-side authorization is authoritative.

## Closed override vocabulary

| Scope | Allowed purpose references |
| --- | --- |
| Default | chat, perception, summary |
| Adapter | chat, perception |
| Endpoint | chat, perception |
| Scene | chat |
| Personal Session | chat preset or inherit |

Each value selects a complete preset. Connection settings, tool authorization, budgets, network policy and generic provider options cannot appear in these overrides. Unknown fields and invalid explicit references are errors, not an invitation to fall back to another layer. The native structured-decision service remains a separate deployment protocol; changing the chat model does not replace it with an ordinary completion.

## Credential and identity boundary

Confirmed: Host-private encrypted key storage with a Host-only local master key; plaintext API keys enter only an authenticated personal management endpoint. Public configuration, Session state, prompts, tool arguments, Journals and exports contain references only. Administrators pre-bind authenticated Console principals to complete IM owners; no self-asserted owner, anonymous/full-token identity assumption or new cross-platform account-link flow.

Personal connections use HTTPS public services only. Same-origin HTTPS redirects are allowed; cross-origin redirects are errors. Authentication query parameters are rejected in stored base URLs; credentials enter only the encrypted API Key field. Each DNS result and redirect hop is checked by the model transport. Host-authored local services retain their existing access. Creating a connection or selecting a model never performs a provider request implicitly. Tests use fake transports and synthetic secrets.

## Private resource access

Public snapshots deliberately omit Root-private resources. Trusted Host operations resolve private services through their active generation lease and that record's existing Scope. The public snapshot, descendant Scopes and same-id forged tokens still cannot retrieve them. This extends the existing generation read seam rather than maintaining another generation registry. Released or foreign leases cannot resolve a service.

## Migration and ownership

Old provider/binding configuration is compiled at the configuration boundary into the same catalog and policy as the new form. Runtime callers do not keep old lookup + new fallback branches. Agent authority fields remain separate from model selection. A migration must preserve explicit retries/fallback declarations rather than inventing new ones.

Scene profiles, scene control, public event cursors, personal Session preferences and transcript epochs are different state owners. They must not be renamed or keyed mechanically as if they were one object. IM routing, Console operations, detached tasks and unattended execution are integrated explicitly; a system-origin task cannot borrow a last sender's personal credentials.

## Confirmed chat failure behavior

All chat turns, including legacy configuration and personal selections, stay on the selected model. Existing same-model retries remain; exhaustion reports the failure without switching models or Providers. Explicitly configured perception fallback chains retain their existing behavior. Generic AI completion ports continue to support explicit fallback chains for callers that own them.

## Validation and acceptance

> **Note:** Model catalog / policy validation is superseded by [ADR 0047](./0047-ai-provider-subscriptions-and-decision-models.md) (`packages/im/ai/tests/provider/`). Personal Session boundary validation lives in `packages/im/agent/tests/personal-session.test.ts`.

1. Closed domain contracts and resolver tests (`packages/im/ai/tests/provider/` after ADR 0047 supersession).
2. Personal identity/selection and independent public-event consumption (`packages/im/agent/tests/personal-session.test.ts`).
3. Root-owned persistence, encrypted credentials and trusted principal mapping.
4. One leased inference path through real IM/standalone/derived entry points; migrate chat/perception/summary consumers without changing native decisions.
5. Personal management and Session model selection interfaces; configuration migration, schema and docs.
6. Integration regressions: real selected model/endpoint/header via fake provider, concurrent owners and connection revisions, cancellation/HMR/disposal, invalid overrides, forbidden access, unchanged history, secret-free projections and legacy records.

Local/mock, CI and real-provider acceptance are separate evidence. No real credentials, provider calls, workspace migration, deployment or publication is authorized by this ADR.
