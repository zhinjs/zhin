---
title: Feature Matrix and Layered Configuration
description: The Console Features section - enable, disable and override features at the global, adapter, account and conversation levels; inheritance and lock rules; in-chat self-service, chat roles; permissions
---

# Feature Matrix and Layered Configuration

The same feature often needs different settings on different platforms, accounts and groups: no RSS on one QQ account, a single item per push on one Telegram account, a higher repeat threshold in one group. The Console **Features** section manages four levels ([ADR 0050](../../adr/0050-layered-feature-config.md), [ADR 0055](../../adr/0055-conversation-feature-config.md)):

| Level | Key | Where it is stored |
| --- | --- | --- |
| Global | — | The plugin's own configuration block; global on / off is `disable_plugins` |
| Adapter | Adapter instance alias (a top-level key such as `qq` or `tg-main`) | `overrides.adapters.<alias>` |
| Account | `<alias>/<endpointId>`, e.g. `qq/bot-1` | `overrides.endpoints."<alias>/<endpointId>"` |
| Conversation | `<alias>/<endpointId>/<kind>:<conversation id>`, e.g. `qq/bot-1/group:123` (`kind` is `group` / `private` / `channel`) | The project database table `feature_conversation_overrides` (not the configuration file) |

```yaml
rss:
  maxItems: 5
  overrides:
    adapters:
      qq: { enabled: false }
    endpoints:
      "tg-main/news": { maxItems: 1 }
```

`overrides` is plain YAML; editing it by hand and editing it in the Console are equivalent. Conversations can number in the hundreds, so their overrides live in the project database: backing up the database backs them up. In keys, conversation ids escape `%` as `%25` and `/` as `%2F`; nothing else changes.

## Pages {#pages}

| Route | Page | Read / write permission |
| --- | --- | --- |
| `/features` | Feature matrix | `feature.view` / `feature.toggle` |
| `/features/global/:plugin` | Global configuration (schema form) | `feature.view` / `feature.configure` |
| `/features/adapters` | Adapter list: alias, type, account count, online count | `feature.view` |
| `/features/adapters/:adapter` | Adapter page: feature overrides for this adapter + account connection management | `feature.*`; adding, changing, starting and stopping accounts needs `endpoint.manage` |
| `/features/adapters/:adapter/endpoints/:endpoint` | Account configuration: feature overrides for this account; the **Conversations** tab searches conversations under it, shows each plugin's state and source there, toggles and edits fields; the **Roles** block manages chat roles | `feature.*`; roles need `iam.manage` |
| `/features/ai` | AI and models (model routing, skills, Ambient, venues) | `agent.view` / `agent.configure` |

The old plugin-detail configuration page redirects to `/features/global/:plugin`. The account workspace in the **Conversations** section has a "Feature configuration" link to the matching account page.

## Feature matrix {#matrix}

Rows are features; columns are "Global" plus one per adapter instance. Each cell is a three-state switch:

- **enabled**;
- **disabled**;
- **disabled by a higher level and locked** — hovering shows "disabled at global / adapter qq" with a link.

Cells with overrides are marked; accounts with conversation overrides show their count (`conversationOverrides` of `feature.matrix`). Click a feature name for its global configuration, or a cell for that level's page. The data comes from `feature.matrix`.

## Inheritance {#resolution}

**Enabled: the higher level wins, one way per level.**

```text
effectively enabled = not in disable_plugins
                    and overrides.adapters[alias].enabled is not false
                    and overrides.endpoints[alias/id].enabled is not false
                    and the conversation override's enabled is not false
```

- A level may only disable while every level above it is enabled.
- Once an upper level (global / adapter / account) disables the plugin, every level below it is locked: it can neither enable nor change its own switch, and shows "disabled by <level>". The RPC answers HTTP 409 `{ success: false, code: 'locked', lockedBy, error: '已被{全局|适配器|账号}层停用，下级开关已锁定' }` (the message text is stable).
- A lower level never stores "enabled": enabling there removes its switch. A lower "disabled" stored before the upper level was disabled is kept ("Remove override" keeps it too).

**Other fields: the lower level wins.** Effective configuration = global → adapter override → account override → conversation override, deep-merged in order: plain objects merge key by key, arrays and scalars replace, and `null` means "explicitly cleared", not "inherit".

Every field shows its source badge: "inherited from global", "inherited from adapter", "overridden here". Editing an inherited field creates an override; an overridden field has "Remove override" to return to inheritance.

- A plugin that does not declare the adapter / account levels (omitting `x-zhin-config.levels` at the schema root means global only) does not appear on adapter and account pages. Every official plugin (adapters aside) declares all four levels, so its switch is available on every page; fields that only make sense globally narrow themselves with `levels: ["global"]` (enforced by `tests/contracts/plugin-feature-levels.test.ts`).
- At the conversation level only the fields listed in the plugin's `x-zhin-config.conversationFields` can be changed; without them the conversation level is a switch only.
- Global-only fields (database connections, API keys) are shown read-only on lower-level forms.
- Plugins without a configuration schema get only the three-level on / off switch, no field overrides.
- Secret values are returned masked.

## When changes apply {#apply}

| What changed | How it applies |
| --- | --- |
| Only `overrides` (including adapter / account on / off) | In place: no restart, no plugin reload; the next message reads the new value |
| Conversation overrides (database) | In place, likewise |
| Global fields | Per the field's declared `x-zhin-config.effect` |
| Global on / off (`disable_plugins`) | Instance restart (handled by the gateway; the Console stays connected) |

When a feature is disabled for an account or a conversation, the Runtime skips it at dispatch for messages in that conversation: commands do not match (and do not answer "disabled"), middleware and handlers do not run, and Agent tools are neither visible nor callable there. Capabilities that do not go through messages, such as scheduled tasks, check `isEnabledFor` themselves.

## RPC and permissions {#rpc}

| RPC | Permission | Purpose |
| --- | --- | --- |
| `feature.list` | `feature.view` | All features and their supported levels |
| `feature.matrix` | `feature.view` | Matrix data |
| `feature.get` | `feature.view` | Schema, values, effective values and sources for one level (including `conversation`, whose `revision` is that override's own) |
| `feature.set-override` | `feature.configure` | Write an override (merge patch) |
| `feature.remove-override` | `feature.configure` | Remove a whole level or specific fields |
| `feature.set-enabled` | `feature.toggle` | Global writes `disable_plugins`; adapter / account write `overrides.*.enabled`; conversation writes the database; 409 when locked |
| `feature.conversations` | `feature.view` | `{ plugin?, adapter?, endpoint?, query?, cursor?, limit? }`: conversations with overrides (paginated) plus conversations the instance saw recently (`hasOverrides: false`) |
| `chat-roles.list` / `grant` / `revoke` | `iam.manage` | Chat roles (below) |

`feature.configure`, `feature.toggle` and `iam.manage` (for `chat-roles.*` only) are checked against scope: an operator bound to adapter `qq` can change overrides and roles on `qq`, its accounts and their conversations only, not global or other adapters; a conversation key counts for its account. File-level writes carry the configuration revision and conversation writes that override's revision, so concurrent edits are rejected rather than overwriting each other.

## In-chat self-service {#self-service}

Off by default. Turn it on in the configuration:

```yaml
features:
  selfService:
    enabled: true          # registers the `feature` / `role` chat commands
    platformAdmins: true   # group owners / admins are admin of their group (default)
    roles: [owner, admin]  # [owner] accepts group owners only
```

| Command | Purpose |
| --- | --- |
| `feature list` / `功能 列表` | Each plugin's state, source level and lock in this conversation, plus your roles |
| `feature enable\|disable <plugin> [level]` | Level: `conversation` (default) / `endpoint` / `adapter` / `global` |
| `feature set <plugin> <field> <value> [level]` | Only the plugin's `selfServiceFields` (widened above the conversation by `chatAdminFields`) |
| `feature reset <plugin> [level]` | Removes that level's override (a locked switch is kept) |
| `feature confirm <code>` | Global enable / disable restarts the instance and must be confirmed within 2 minutes |

- The sender needs the chat role `admin` or `owner` at the target scope (the current conversation's ancestor at the chosen level).
- The conversation level writes the database; account / adapter levels write the configuration file `overrides` (in place); the global switch writes `disable_plugins` and restarts.
- Conversation overrides for private chats can only be changed in the Console.
- Every change is audited by the instance (actor `chat:<adapter alias>:<user id>`, with level and scope).

## Chat roles {#chat-roles}

Who may do what in chat follows the roles of [ADR 0056](../../adr/0056-chat-roles.md): `owner` ⊃ `admin` ⊃ `trusted`, inherited downward along conversation → account → adapter → global, held by the identity `(adapter alias, user id)`. Sources:

| Source | Meaning |
| --- | --- |
| Grant (`chat_roles` table) | The Console **Roles** block, or `role grant\|revoke <user> <role> [level]` / `角色 授予\|撤销 …` in chat |
| Configuration | An adapter account's `owner` → account-level `owner`, `trusted` → account-level `trusted`; `ai.trigger.masters` / `trusted` → global (the same user id on every platform) |
| Mapping | Platform group owner / admin → `admin` of that conversation (computed live per message; can be narrowed or turned off) |

When granting in chat, the grantor needs at least the granted role at the target scope; `owner` can only be granted or revoked by an `owner` at a higher level. `role list` shows the roles effective in this conversation and their sources.

For plugin authors — declaring levels, conversation fields and reading effective configuration (`context.configFor` / `context.isEnabledFor`) — see [definePlugin](../authoring/define-plugin.md#layered-config), [ADR 0050](../../adr/0050-layered-feature-config.md) and [ADR 0055](../../adr/0055-conversation-feature-config.md).
