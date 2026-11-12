---
title: Upgrading to Chat Roles
description: Moving from master / trusted configuration lists to ADR 0056 chat roles — automatic migration, master → owner, permit mapping, mapping rules and plugin changes
---

# Upgrading to chat roles (ADR 0056)

This release replaces the framework-level `master` / `trusted` roles and the group owner / admin strings that plugins checked on their own with one model of **chat roles** ([ADR 0056](../../adr/0056-chat-roles.md)):

- There are three zhin roles: `owner` ⊃ `admin` ⊃ `trusted`. `master` is renamed to `owner`.
- Roles are held at four levels (global / adapter / account / conversation) and inherited downward. People lists live in the project database table `chat_roles`, no longer in the configuration file.
- A platform group owner / admin is no longer a framework role by itself: **mapping rules** turn the platform identity into a role of the current conversation, live. The default rule is “group owner / admin → `admin` of this conversation”.

See [Chat roles](../concepts/chat-roles.md) for the concepts.

## 1. The configuration migrates automatically

On the first start with this version the instance:

1. reads the people lists from the configuration:
   | Old field | Becomes |
   | --- | --- |
   | adapter block `<alias>.master` | adapter-level `owner` (every account of that adapter) |
   | adapter block `<alias>.trusted` | adapter-level `trusted` |
   | `<alias>.endpoints[i].master` | account-level `owner` (key `<alias>/<account id>`, the name when there is no id) |
   | `<alias>.endpoints[i].trusted` | account-level `trusted` |
   | `ai.trigger.masters` | global `owner`, one identity per configured adapter |
   | `ai.trigger.trusted` | global `trusted`, likewise |
2. records the grants in `.zhin/chat-roles-migration.json` (status `pending`), removes the fields from the configuration file and logs which fields moved;
3. once the database is ready, writes them to `chat_roles` (an existing grant for the same identity and scope is kept) and marks the record `done`.

If the process exits half-way, the next start resumes from the `pending` record. Without a relational database (sqlite / mysql / pg) grants live in memory only; the record stays `pending` and is replayed on every start.

After the migration, configuration that names these fields **again** stops startup (`LEGACY_CHAT_ROLE_CONFIG`) and points here. Use instead:

- the Console: the **Roles** block on adapter / account / conversation pages (`chat-roles.grant` / `revoke`, permission `iam.manage`);
- chat: with `features.selfService.enabled`, `role grant <user> <owner|admin|trusted> [level]` / `角色 授予 …`.

::: warning Interim switches removed
`features.selfService.platformAdmins`, `features.selfService.roles` and `features.selfService.allowUsers` are gone and fail validation (no compatibility). How group owners / admins map is decided by [`roles.mappings`](#mappings):

| Before | Now |
| --- | --- |
| `platformAdmins: true` (default) | nothing: the default rule already maps group owner / admin → conversation `admin` |
| `platformAdmins: false` | adapter block `roles: { inherit: false }` (with no rules) |
| `roles: [owner]` | see the “owners only” example below |
:::

## 2. Mapping rules `roles.mappings` {#mappings}

Write them in the adapter block (all its accounts) or in an account entry (`endpoints[i].roles`); conversation-level rules live in the database and are managed on the Console conversation page or through `chat-roles.set-mappings`.

```yaml
qq:
  roles:
    mappings:
      # Group owners only: drop the default rule, then grant admin to owners
      - match: { standing: [admin, owner] }
        grant: none
      - match: { standing: [owner] }
        grant: admin
  endpoints:
    - id: bot-1
      roles:
        inherit: false   # no mapping at all for this account (not even the default)
```

- `match` takes `standing` (`owner` / `admin` / `member` / `guest`), `role` (platform role ids) and `permission` (platform permission names); every given criterion must hold, any value within one criterion matches.
- Lower levels add rules or override a rule with the same `match` from above; `grant: none` removes an inherited rule with the same `match`; `inherit: false` drops every rule from above, the default included.
- A mapped role applies only to the conversation of the message, computed live from the current platform identity, never stored.
- The configuration file can grant only `admin`; mappings to `trusted` / `owner` exist only at the conversation level and never yield a role at the account level or above.

## 3. `master` → `owner`

| Where | Before | Now |
| --- | --- | --- |
| Sender role | `master` / `trusted` in `sender.roles` | `sender.chatRole` (`owner` / `admin` / `trusted`, set by the Runtime) |
| Platform identity | `owner` / `admin` strings in `sender.roles` | `sender.platform.standing` (absent in private chats) |
| Command session | `session.sender.role` (array) | `session.sender.chatRole` and `session.sender.platform` |
| Operation session | `OperationSession.sender.authorizationRoles` / `platformRoles` | `OperationSession.sender.chatRole` / `platform` |
| `@zhin.js/core` | `SenderRole`, `senderRolesFromMessage`, `roleSatisfies`, `hasSenderRole`, `normalizeSenderRoles`, `formatSenderRolesForLabel`, `isFrameworkSenderRole` | `ChatRole`, `chatRolesFromMessage`, `chatRoleIncludes`, `chatRolesInclude`, `expandChatRole` |
| Agent turn principal | `principal.roles` holds `master` (mixed with platform roles) | `principal.roles` holds only the expanded chat roles (`owner` → `owner, admin, trusted`) or `user`; the platform standing is `principal.platform` |
| `@zhin.js/agent` | `SenderRole`, `SELF_CHANGE_MASTER_ROLE`, `master` in `ToolRequesterRole` | `PrincipalRole`, `SELF_CHANGE_OWNER_ROLE`, `owner` |
| `@zhin.js/core/runtime` | `createEndpointRoleResolver`, `createEndpointRoleConfigurationSelection`, `createSenderEnricher(config, resolver)`, `createConfigurationChatAuthorizer(config, resolver)` | `createSenderEnricher({ roles })`, `createConfigurationChatAuthorizer(roles, snapshot)`, `senderOwnsReceivingAdapter` |
| `ai.trigger` | `masters` / `trusted` | removed (moved into `chat_roles`) |

Participant header role labels in prompts change accordingly: platform standing `owner` / `admin`, chat roles `bot_owner` / `bot_admin` / `trusted`.

## 4. permit / tool `permissions` mapping {#permits}

Command `permit` and Agent tool `permissions` share one built-in DSL (AND across the list, comma means OR inside one rule):

| Before | Now | Meaning |
| --- | --- | --- |
| `role(master)` | `owner` | chat role along this conversation's scope chain |
| `role(trusted)` | `trusted` (or `role(trusted)`) | `admin` / `owner` also qualify |
| `role(admin)` (platform admin) | `admin` or `platform:admin` | `admin` is the chat role (group admins get it from the default mapping); `platform:admin` looks at the platform identity only |
| `role(owner,admin,master)` | `admin` | |
| `role(owner,admin,master,trusted)` | `trusted` | |
| `role(user)` | drop the rule | everyone qualifies |
| `scene_admin` / `platform(<adapter>,scene_admin)` | `platform:admin` | normalized standing; `platform:admin` also accepts the owner |
| `scene_owner` / `platform(<adapter>,scene_owner)` | `platform:owner` | |
| `platform(<adapter>,<perm>)` | `platform-permission:<perm>` | reads `sender.platform.permissions` |
| — | `platform-role:<id>` | a platform-native role id (e.g. a Discord role) |

Removed spellings fail when a command / tool is defined, and the error names the replacement. `@zhin.js/permission` drops the `platform(adapter,perm)` API: `PermissionHost.registerPlatform`, `PlatformPermitChecker`, `definePlatformPermission`, `createSceneRolePlatformChecker`, `platformPermission()`, `isPlatformPermit`, `parsePlatformPermitName`; `PermissionSubject.sender` is now `{ id, name?, chatRole?, platform? }`.

`CONVERSATION_MANAGER_PERMIT` in `@zhin.js/command` is now `admin` (`canManageConversation` = a private chat, or `admin` of this conversation).

`requiredRoles` of Console pages and plugin RPCs are still **Console account role names** (ADR 0049) and are unaffected.

## 5. Other behavior changes

- **Agent security policies**: dangerous tools, file policy and owner approval follow `sender.chatRole`; `owner` is the former `master`, `admin` and `trusted` share the trusted tier. The default mapping makes group owners / admins `admin` of their conversation, so they get the trusted tool tier too; turn the default off or tighten it with `roles.mappings` if you do not want that. Approval DMs go to the stored `owner` of the account (or its adapter / global).
- **Group rules**: the “owners and admins are exempt” option and rule approval check the chat role `admin` of the conversation.
- **Content moderation**: `masters` and `inbound.bypassMasters` are removed in favor of `inbound.bypassRole` (`owner` / `admin` / `trusted` / `none`, default `owner`).
- **Account management commands** (`<adapter> endpoint add|remove`), restart from chat and configuration from chat need the chat role `owner`. The former “anyone may run them when no master is configured” is gone.
- **Global owners** migrated from `ai.trigger.masters` are bound per adapter, so they may also use configuration from chat in private.
- **Test kit** `@zhin.js/testing`: `createFakeMessage({ sender: { id, chatRole } })`; `PluginTestKit.receive` trusts the declared `sender.chatRole` / `platform`.

## 6. Adapter authors

Adapters report the normalized platform identity on `sender.platform` of inbound messages (`PlatformStanding` in `@zhin.js/im-contract`) and declare in their capability profile which of `standing` / `roles` / `permissions` they report. During the transition the Runtime still derives `platform` from the legacy `sender.roles` (`owner` / `admin`) and `sender.permissions`. Tools using `platform-permission:<name>` need the adapter to put those names into `sender.platform.permissions`.
