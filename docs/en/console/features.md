---
title: Features and Layered Configuration
description: The Features and Roles tabs of the Console object pages - enable, disable and override features at the global, adapter, account and conversation levels; inheritance and lock rules; the feature matrix; in-chat self-service, chat roles; permissions
---

# Features and Layered Configuration

The same feature often needs different settings on different platforms, accounts and groups: no RSS on one QQ account, a single item per push on one Telegram account, a higher repeat threshold in one group. The Console manages the four levels of its object tree, and every object page has a **Features** tab ([ADR 0050](../../adr/0050-layered-feature-config.md), [ADR 0055](../../adr/0055-conversation-feature-config.md)):

| Level | Key | Where it is stored |
| --- | --- | --- |
| Global | — | The plugin's own block in the configuration file; global on / off is `disable_plugins` |
| Adapter | Adapter instance alias (a top-level key such as `qq` or `tg-main`) | The project database table `feature_overrides` (`level = 'adapter'`) |
| Account | `<alias>/<endpointId>`, e.g. `qq/bot-1` | Same table (`level = 'endpoint'`) |
| Conversation | `<alias>/<endpointId>/<kind>:<conversation id>`, e.g. `qq/bot-1/group:123` (`kind` is `group` / `private` / `channel`) | Same table (`level = 'conversation'`) |

The global default lives in the configuration file and is reviewed with the code; the adapter, account and conversation levels are runtime state changed from the Console or in chat, so they live in the project database ([ADR 0057](../../adr/0057-config-storage.md), Chinese): backing up the database backs them up. A plugin block in the configuration file no longer accepts `overrides`; an existing project imports them on its first start, see [Upgrading: feature overrides move to the database](../migrations/feature-overrides.md). In keys, conversation ids escape `%` as `%25` and `/` as `%2F`; nothing else changes.

With a MongoDB, Redis or memory database these three levels cannot be saved: `feature.get` / `feature.conversations` answer `persistent: false` and writes are refused (HTTP 503, `code: 'feature-overrides-unpersisted'`; in chat, "Not saved: feature overrides need a relational project database …"), the same as [chat roles](../concepts/chat-roles.md).

## Where to change it {#pages}

There are no separate "adapter" or "account configuration" pages any more: feature settings live in the **Features** tab of every object page in the [object tree](./index.md#navigation):

| Place | Route | What it does | Read / write permission |
| --- | --- | --- | --- |
| Global Features tab | `/scope?tab=features` | Overview of every feature: settable levels, the global switch, how many levels below have their own settings; the **Matrix** view (`&view=matrix`) shows each feature's switch globally and per adapter. Click a feature name for its global settings | `feature.view` / global switch `plugin.manage` |
| Adapter Features tab | `/scope/:adapter?tab=features` | Applies to every account and conversation of the adapter | `feature.view` / `feature.configure`, `feature.toggle` |
| Account Features tab | `/scope/:adapter/:endpoint?tab=features` | Applies only to the account and its conversations | Same |
| Conversation Features tab | `/scope/:adapter/:endpoint/:conversation?tab=features` | Applies only to this conversation; only fields the plugin declares as conversation-level can change | Same |
| Feature matrix | `/features` | A standalone entry to the same matrix as the global Features tab | `feature.view` / global column `plugin.manage`, adapter columns `feature.toggle` |
| Global settings | `/features/global/:plugin` | The plugin's global configuration (schema form) | `feature.view` / `feature.configure` |
| **Where it is on** in plugin details | `/plugins/:name` | A summary only: the global and per-adapter switches and how many conversations override the plugin (account switches are in each account's Features tab), linking to the matching Features tab | `plugin.manage` |

The adapter, account and conversation Features tabs work the same way:

- One row per plugin: effective state (on / off / locked), source level, how many fields are overridden here. Filter by All, Overridden here, Off or Locked, or search.
- Expand a row to see each field's **inherited / overridden here / effective value / source**. Editing a field creates an override at this level; **Remove override** returns it to the inherited value, and **Remove all** deletes every override of that plugin at this level.
- Switches, overrides and removals go through **Review change** and are confirmed in an [action receipt](./index.md#receipts); switching off warns that no scope below this level can switch it back on.
- A plugin switched off above shows "Locked by …" with a link to the locking level; this level cannot switch it on or change its switch.
- Features with global settings only are not listed below the global level; find them in the global Features tab. If the Host does not support per-level settings, the tab says a newer Host is needed and keeps the settings from above.

The account Overview lists conversations with overrides and recently active ones; the conversation Overview lists the features changed for that conversation only.

## Feature matrix {#matrix}

Rows are features; columns are "Global" plus one per adapter instance. Each cell is a three-state switch:

- **enabled**;
- **disabled**;
- **disabled by a higher level and locked** — hovering shows "disabled globally", "disabled at the adapter" or "disabled at the account" with a link.

Cells with overrides are marked; accounts with conversation overrides show their count (`conversationOverrides` of `feature.matrix`). Click a feature name for its global settings, or an adapter name for its Features tab. A global switch is plugin lifecycle: the management gateway runs it as a transaction (stop the instance → write `disable_plugins` → start the instance; if it does not start, the configuration is restored and the previous instance started again). It needs `plugin.manage`, and the confirmation says the instance restarts. The data comes from `feature.matrix`.

## Inheritance {#resolution}

**Enabled: the higher level wins, one way per level.**

```text
effectively enabled = not in disable_plugins
                    and the adapter override's enabled is not false
                    and the account override's enabled is not false
                    and the conversation override's enabled is not false
```

- A level may only disable while every level above it is enabled.
- Once an upper level (global / adapter / account) disables the plugin, every level below it is locked: it can neither enable nor change its own switch, and shows `disabled by <level>`. The RPC answers HTTP 409 `{ success: false, code: 'locked', lockedBy, error: '已被{全局|适配器|账号}层停用，下级开关已锁定' }` (the message text is stable).
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
| Adapter / account / conversation overrides and switches (database) | In place: no restart, no plugin reload; the next message reads the new value. Other instances sharing the database see it within 5 seconds |
| Global fields | Per the field's declared `x-zhin-config.effect` |
| Global on / off (`disable_plugins`) | Gateway enable / disable transaction: stop the instance, write, start, roll back on failure (the Console stays connected) |

When a feature is disabled for an account or a conversation, the Runtime skips it at dispatch for messages in that conversation: commands do not match (and do not answer "disabled"), middleware and handlers do not run, and Agent tools are neither visible nor callable there. Capabilities that do not go through messages, such as scheduled tasks, check `isEnabledFor` themselves.

## RPC and permissions {#rpc}

| RPC | Permission | Purpose |
| --- | --- | --- |
| `feature.list` | `feature.view` | All features and their supported levels |
| `feature.matrix` | `feature.view` | Matrix data |
| `feature.get` | `feature.view` | Schema, values, effective values and sources for one level; `revision` is the configuration file's at the global level and the stored override's own at the adapter / account / conversation levels (`'0'` when none exists) |
| `feature.set-override` | `feature.configure` | Write an override (merge patch) |
| `feature.remove-override` | `feature.configure` | Remove a whole level or specific fields |
| `feature.set-enabled` | `feature.toggle`; global level `plugin.manage` | Global writes `disable_plugins` (intercepted by the gateway and run as an enable / disable transaction, see below); adapter / account / conversation write the database; 409 when locked |
| `plugin:set-enabled` | `plugin.manage` | `{ instanceKey, enabled }`: the same gateway transaction as the global `feature.set-enabled` |
| `feature.conversations` | `feature.view` | `{ plugin?, adapter?, endpoint?, query?, cursor?, limit? }`: conversations with overrides (paginated) plus conversations the instance saw recently (`hasOverrides: false`) |
| `chat-roles.list` / `grant` / `revoke` | `iam.manage` | Chat roles (below) |

The **global switch** (`feature.set-enabled` at the global level and `plugin:set-enabled`) is plugin lifecycle, not a feature switch: the management gateway intercepts it before forwarding to the instance, authorizes it with `plugin.manage` (an operator holding only `feature.toggle` is refused; non-owners can only toggle packages in the managed catalog, project-local plugins are owner-only), runs the same transaction as `gateway.plugins.enable` / `disable`, and answers in the RPC's existing reply shape (plus `transaction`; `restartRequired: true` means the instance was restarted for it). Already in the requested state answers `unchanged` and leaves the instance alone. A failed or rolled-back transaction answers `{ success: false, code: 'transaction_failed' | 'rollback_failed', error, transaction }`. After a change the event stream carries `plugin:lifecycle-updated`. The instance no longer writes the global switch itself: without a gateway (`zhin start --standalone`) it is refused (`feature.set-enabled` answers 409 `gateway-required`); use `zhin enable` / `zhin disable <plugin>` or run under `zhin start`.

`feature.configure`, `feature.toggle` and `iam.manage` (for `chat-roles.*` only) are checked against scope: an operator bound to adapter `qq` can change overrides and roles on `qq`, its accounts and their conversations only, not global or other adapters; a conversation key counts for its account. Adapter / account / conversation writes carry that override's revision (`expectedRevision`), so concurrent edits are rejected (`conflict`) rather than overwriting each other; for older Console builds the adapter / account levels still accept the configuration revision returned by `feature.list` / `feature.matrix` (no row check while it is current, a conflict otherwise).

## In-chat self-service {#self-service}

Off by default. Turn it on in the configuration:

```yaml
features:
  selfService:
    enabled: true          # registers the `feature` / `role` chat commands
```

Feature switches are a zhin function: platform group owners / admins do not become `admin` of their group automatically and need a grant (see [Chat roles](../concepts/chat-roles.md)).

| Command | Purpose |
| --- | --- |
| `feature list [page]` / `功能 列表 [页码]` | State, source level and lock (including `enabled: false` in configuration and global disables) of the plugins that apply here (with commands / middlewares / handlers; adapters, service-only plugins and plugins for other platforms are left out), plus your roles; 15 per page |
| `feature enable\|disable <plugin> [level]` | Level: `conversation` (default) / `endpoint` / `adapter` / `global` |
| `feature set <plugin> <field> <value> [level]` | Only the plugin's `selfServiceFields` (widened above the conversation by `chatAdminFields`); the value is the rest of the text after the field, quote values with spaces or ending in a level word (`"…"`, `“…”`, `「…」`, …), e.g. `feature set group-suite welcomeMessage "Welcome {name}"` |
| `feature reset <plugin> [level]` | Removes that level's override (a locked switch is kept) |
| `feature confirm <code>` | Global enable / disable restarts the instance and must be confirmed within 2 minutes |

- The sender needs the chat role `admin` or `owner` at the target scope (the current conversation's ancestor at the chosen level).
- The conversation, account and adapter levels write the database (in place); the global switch is written by the instance to `disable_plugins` and requests a restart (unlike the Console, not yet a gateway transaction and not rolled back on failure).
- Conversation overrides for private chats can only be changed in the Console.
- Every change is audited by the instance (actor `chat:<adapter alias>:<user id>`, with level and scope).

## Chat roles {#chat-roles}

Who may do what in chat follows the roles of [ADR 0056](../../adr/0056-chat-roles.md): `owner` ⊃ `admin` ⊃ `trusted`, inherited downward along conversation → account → adapter → global, held by the identity `(adapter alias, user id)`. See [Chat roles](../concepts/chat-roles.md) for the full model. Sources:

| Source | Meaning |
| --- | --- |
| Grant (`chat_roles` table, `source: 'grant'`) | The **Roles** tab of the object pages, or `role grant\|revoke <user> <role> [level]` / `角色 授予\|撤销 …` in chat; the only source of zhin roles |

Platform standing (the sender's group owner / admin / roles / permissions, and the bot's own standing in the group) is never converted into a zhin role; it is used only by the `platform:*` / `bot:*` permit conditions.

The configuration file no longer holds people lists: the old account `master` / `trusted` and `ai.trigger.masters` / `trusted` move into `chat_roles` on the first start; see [Upgrading to chat roles](../migrations/chat-roles.md).

In the Console, the object page at every level has a **Roles** tab (needs `iam.manage`; a scoped binding on that adapter / account counts): it lists the roles effective at this level, those granted here and those inherited from above, and **Grant a role** (enter the platform user ID, choose Owner / Administrator / Trusted). Revoking removes only roles granted directly at this level. A global role can register one identity per platform; below the global level an identity can only belong to that scope's own adapter.

When granting in chat, the grantor needs at least the granted role at the target scope; `owner` can only be granted or revoked by an `owner` at a higher level. `role list` shows the roles effective in this conversation and their sources.

For plugin authors — declaring levels, conversation fields and reading effective configuration (`context.configFor` / `context.isEnabledFor`) — see [definePlugin](../authoring/define-plugin.md#layered-config), [ADR 0050](../../adr/0050-layered-feature-config.md) and [ADR 0055](../../adr/0055-conversation-feature-config.md).
