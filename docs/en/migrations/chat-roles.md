---
title: Upgrading to Chat Roles
description: Moving from master / trusted configuration lists to ADR 0056 chat roles — automatic migration, master → owner, permit mapping, platform standing and the Bot's own standing (bot:*), plugin changes
---

# Upgrading to chat roles (ADR 0056)

This release replaces the framework-level `master` / `trusted` roles and the group owner / admin strings that plugins checked on their own with one model of **chat roles** ([ADR 0056](../../adr/0056-chat-roles.md)):

- There are three zhin roles: `owner` ⊃ `admin` ⊃ `trusted`. `master` is renamed to `owner`.
- Roles are held at four levels (global / adapter / account / conversation) and inherited downward. People lists live in the project database table `chat_roles`, no longer in the configuration file.
- A platform group owner / admin is **not** a zhin role and is never converted into one: zhin roles govern zhin functions, platform standing governs platform functions. Whether a command or tool is available is decided by three dimensions: the sender's zhin role, the sender's platform standing and the Bot's own platform standing.

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

- the Console: the **Roles** tab of the global / adapter / account / conversation object pages (`chat-roles.grant` / `revoke`, permission `iam.manage`);
- chat: with `features.selfService.enabled`, `role grant <user> <owner|admin|trusted> [level]` / `角色 授予 …`.

::: warning Removed, no compatibility
These fields stop startup (`LEGACY_CHAT_ROLE_CONFIG`):

- `features.selfService.platformAdmins`, `features.selfService.roles`, `features.selfService.allowUsers`;
- `roles` of an adapter block (`roles.mappings` / `roles.inherit`) and `endpoints[i].roles` of an account — the platform standing → zhin role mapping rules were removed (see section 2).
:::

## 2. Platform standing is no longer mapped into zhin roles {#mappings}

The preview implementation turned platform group owners / admins into `admin` of the conversation through `roles.mappings`. That mapping is gone, together with the Console RPCs `chat-roles.mappings` / `chat-roles.set-mappings` and the conversation-level `chat_role_mappings` table; `chat-roles.list` no longer returns entries with `source: 'mapping'`.

| Relied on the mapping | Now |
| --- | --- |
| Group owners / admins use the `feature` / `role` commands in the group | grant them zhin `admin` (`role grant @owner admin`, or the conversation page's **Roles** tab) |
| Group owners / admins manage subscriptions (Bilibili, earthquake and other `canManageConversation` commands) | same: subscriptions are a zhin function |
| Group owners / admins got the Agent trusted tier (`admin` ⊃ `trusted`) | no longer: Agent trust tiers read zhin roles only |
| A tool / command requires the sender to be a group manager | write `platform:admin` (or `platform:owner`, `platform-permission:<name>`) |
| Group rule exemption for owners and admins | exempts platform owners / admins (`platform:admin`) and the zhin `owner`, see section 5 |

## 3. `master` → `owner`

| Where | Before | Now |
| --- | --- | --- |
| sender role | `master` / `trusted` in `sender.roles` | `sender.chatRole` (`owner` / `admin` / `trusted`, set by the Runtime) |
| platform identity | `owner` / `admin` strings in `sender.roles` | `sender.platform.standing` (absent in private chats) |
| command session | `session.sender.role` (array) | `session.sender.chatRole` and `session.sender.platform` |
| operation session | `OperationSession.sender.authorizationRoles` / `platformRoles` | `OperationSession.sender.chatRole` / `platform` |
| `@zhin.js/core` | `SenderRole`, `senderRolesFromMessage`, `roleSatisfies`, `hasSenderRole`, `normalizeSenderRoles`, `formatSenderRolesForLabel`, `isFrameworkSenderRole` | `ChatRole`, `chatRolesFromMessage`, `chatRoleIncludes`, `chatRolesInclude`, `expandChatRole` |
| Agent turn principal | `principal.roles` with `master` (mixed with platform roles) | `principal.roles` holds only the expanded chat roles (`owner` → `owner, admin, trusted`) or `user`; the platform standing is `principal.platform` |
| `@zhin.js/agent` | `SenderRole`, `SELF_CHANGE_MASTER_ROLE`, `master` in `ToolRequesterRole` | `PrincipalRole`, `SELF_CHANGE_OWNER_ROLE`, `owner` |
| `@zhin.js/core/runtime` | `createEndpointRoleResolver`, `createEndpointRoleConfigurationSelection`, `createSenderEnricher(config, resolver)`, `createConfigurationChatAuthorizer(config, resolver)` | `createSenderEnricher({ roles })`, `createConfigurationChatAuthorizer(roles, snapshot)`, `senderOwnsReceivingAdapter` |
| `ai.trigger` | `masters` / `trusted` | removed (migrated into `chat_roles`) |

Role labels in the chat prompt's participant headers change accordingly: platform standing `owner` / `admin`, chat roles `bot_owner` / `bot_admin` / `trusted`.

## 4. permit / tool `permissions` mapping {#permits}

Command `permit`, Agent tool / skill `permissions`, and middleware and button `permit` share one built-in DSL and one evaluator (list entries AND, comma-separated values inside one entry OR):

| Before | Now | Notes |
| --- | --- | --- |
| `role(master)` | `owner` | zhin role along this conversation's scope chain |
| `role(trusted)` | `trusted` (or `role(trusted)`) | `admin` / `owner` also qualify |
| `role(admin)` (platform admin) | `platform:admin`, or zhin `admin` | platform functions use `platform:admin`; zhin functions use `admin` (granted) |
| `role(owner,admin,master)` | `admin` or `platform:admin` | as above, by what the function governs |
| `role(owner,admin,master,trusted)` | `trusted` | |
| `role(user)` | drop the rule | everyone qualifies |
| `scene_admin` / `platform(<adapter>,scene_admin)` | `platform:admin` | normalized standing; `platform:admin` also accepts the owner |
| `scene_owner` / `platform(<adapter>,scene_owner)` | `platform:owner` | |
| `platform(<adapter>,<permission>)` | `platform-permission:<permission>` | reads `sender.platform.permissions` |
| — | `platform-role:<id>` | platform-native role id (e.g. a Discord role) |
| `currentConversationBotRoles: ['owner', 'admin']` | `bot:admin` | the Bot's own normalized standing (new) |
| `currentConversationBotRoles: ['owner']` | `bot:owner` | |
| — | `bot-role:<id>` / `bot-permission:<name>` | the Bot's own platform role / permission (e.g. `bot-permission:ban_members`) |

A platform action the bot performs usually names both the sender and the bot, e.g. a mute tool: `permissions: ['platform:admin', 'bot:admin']`. `currentConversationBotRoles` remains for exact sets a permit cannot express (e.g. "leave the group only when the bot is not its owner": `['admin', 'member']`).

Removed spellings fail when the command, middleware or Agent tool is defined, and the error names the replacement. `@zhin.js/permission` dropped the `platform(adapter,perm)` APIs: `PermissionHost.registerPlatform`, `PlatformPermitChecker`, `definePlatformPermission`, `createSceneRolePlatformChecker`, `platformPermission()`, `isPlatformPermit`, `parsePlatformPermitName`; `PermissionSubject.sender` is now `{ id, name?, chatRole?, platform? }` and `PermissionSubject.bot` (the Bot's own standing) is new.

`CONVERSATION_MANAGER_PERMIT` of `@zhin.js/command` is now `admin` (`canManageConversation` = private chat, or zhin `admin` of this conversation).

`requiredRoles` of Console pages and plugin RPCs are still **Console account role names** (ADR 0049) and are not affected.

## 5. Other behavior changes

- **Agent security policies**: dangerous tools, file / exec policy and owner approval read `sender.chatRole` only; `owner` equals the old `master`, `admin` and `trusted` share the trusted tier. A platform group owner / admin no longer gets the trusted tier from their standing. Approval DMs go to the `owner` stored on the account (or its adapter / global).
- **Agent pre-turn filtering**: tools / skills are disclosed for a turn only after the three-dimension check; the Bot standing is read at the start of the turn (cached), a failed lookup leaves every `bot:*` unmet; tools are checked again when executed.
- **Commands**: checked before dispatch by the same evaluator; unmet `platform:*` / `bot:*` conditions are named in the reply (e.g. 「无法执行此指令：机器人不是本群管理员（或无法确认其身份）。」); the menu lists only commands the sender can run here.
- **Group rules**: the owner / admin exemption (`exempt.ownerAndAdmins`) exempts platform owners / admins (`platform:admin`) and the zhin `owner`; a zhin `admin` is no longer exempt automatically. Rule approval still needs zhin `admin`.
- **Content moderation**: `masters` and `inbound.bypassMasters` are removed in favor of `inbound.bypass` — a list of permit expressions, any of which skips inbound review; the default is `[owner, "platform:admin"]` (moderation is a platform function: the zhin owner and platform owners / admins are exempt), `[]` reviews everyone.
- **Account management commands** (`<adapter> endpoint add|remove`), restart from chat and configuration from chat need the zhin role `owner`. The old "everyone may run it while no master is configured" fallback is gone.
- **Global owners**: global owners migrated from `ai.trigger.masters` have one identity per adapter, so they can also use configuration from chat in private chats.
- **Scaffolding**: the ICQQ wizard no longer asks for an owner QQ account or writes `master`; afterwards it points to the account's **Roles** tab in the Console, or `role grant <QQ> owner endpoint` sent in chat by an existing owner.
- **Testing** `@zhin.js/testing`: `createFakeMessage({ sender: { id, chatRole } })`; `PluginTestKit.receive` trusts the `sender.chatRole` / `platform` a test declares.

## 6. Adapter authors

- Report the sender's normalized platform standing on `sender.platform` of inbound messages (`PlatformStanding` from `@zhin.js/im-contract`) and declare which of `standing` / `roles` / `permissions` you report in the capability profile's `scene.platformStanding`. During the transition the Runtime still derives `platform` from the old `sender.roles` (`owner` / `admin`) and `sender.permissions`.
- When the platform can tell the bot's own standing in a conversation, implement `management.inspectSelfStanding({ conversation, signal })` (returns a `PlatformStanding` or `undefined`) and declare `scene.selfStanding`. Do not cache or call it per message: the framework caches through `AdapterIndex.selfStanding` per conversation and drops the entry on the bot's role-change events (`member.role_changed`, the bot's own `member.joined` / `member.left`). Declaring `scene.selfStanding` without the method fails at assembly.
- Tools that use `platform-permission:<name>` / `bot-permission:<name>` need the adapter to put those names into the matching standing's `permissions`.
