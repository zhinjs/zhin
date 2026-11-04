---
outline: deep
---

# Personal Sessions and model purposes

One authenticated person has a distinct AI Session in each private chat, group or channel. Changing its model preserves readable history; restoring inheritance removes the explicit selection. Group events remain shared scene context, rather than a single private Session for all participants.

## Selection and scope

Chat resolves in this order: personal Session selection > scene > Endpoint > Adapter > deployment default. Explicit Agent roles use their Host Profile purpose. Selecting a Host role model does not grant Host administration rights to the caller.

| Scope | Selectable purposes |
| --- | --- |
| Deployment | chat, summary, ambient language, perception chain, image, six decisions, Agent roles |
| Adapter / Endpoint | chat, perception |
| Scene | chat |
| Personal Session | chat Profile or inherit |

Summary and ambient language inherit deployment chat when omitted, never personal credentials. The structured `decisions.ambient` purpose is separate. Overrides select Profiles; they do not deep-merge arbitrary connection settings, permissions or SDK options.

## Runtime changes

Manage Services, Accounts, Profiles and purposes in Console. The runtime database is authoritative. Saving changes affects the next operation without editing startup files or restarting the process. An in-flight turn, its tool follow-ups and retries retain their original graph and Account identity; each real request obtains the current credential version for that Account.

A Session stores durable Profile identity with its Account incarnation pin, not a label or a permanently frozen revision. Updating parameters or the native model of the same Profile takes effect next turn. The old operation stays fixed and opaque supplier state cannot cross models. Recreating an Account with the same name does not inherit old Sessions or private settings.

Missing or unauthorized explicit selections report an error instead of falling back to deployment chat. Storage lookup failures do not become an absent preference. Unknown configuration commit outcomes retain the original mutationId and query its receipt rather than replaying under another ID.

Administrators pre-bind Console principals to exact IM owners through `ai.personalPrincipals`. Personal Accounts currently support API Keys, encrypted in the Host-owned credential repository; public metadata and model prompts contain no keys. Personal connections permit public HTTPS targets, checked DNS and same-origin HTTPS redirects. Authentication query parameters must use the key form. Host-authored local services remain separate from these personal network rules.

`ai.plan.yml` is an explicit import proposal, not a startup baseline. Legacy configuration and Session presets require reviewed mappings; original data is retained for recovery. See [Services and subscriptions](../../ai/providers.md) and [upgrade / version boundaries](../../ai/provider-upgrade.md). Local fixture checks, real-provider acceptance and deployment remain separate evidence.
