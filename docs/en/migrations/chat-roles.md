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
   | adapter block `<alias>.master` | account-level `owner` on every account **without its own `master`** (as before: an account's own master replaced the adapter one); never an adapter-level owner |
   | adapter block `<alias>.trusted` | adapter-level `trusted` |
   | `<alias>.endpoints[i].master` | account-level `owner` (key `<alias>/<account id>`, the name when there is no id) |
   | `<alias>.endpoints[i].trusted` | account-level `trusted` |
   | `ai.trigger.masters` | global `owner`, one identity per configured adapter — except local simulation adapters (capability profile `runtime.sandbox`, whose clients choose their sender id) and adapters that failed to load; both are logged |
   | `ai.trigger.trusted` | global `trusted`, likewise |
2. records the grants in `.zhin/chat-roles-migration.json` (status `pending`), removes the fields from the configuration file and logs which fields moved;
3. once the database is ready, writes them to `chat_roles` (for an existing grant of the same identity and scope **the higher role wins**: imports only raise, never lower or remove, ADR 0060 §4.3) and marks the record `done` with each grant's outcome (`imported`). The Console inbox shows the information item `chat-roles.imported` to review, revoke or mark as read.

If the process exits half-way, the next start resumes from the `pending` record. Without a relational database (sqlite / mysql / pg) the migrated grants take effect in memory only and the record stays `pending` (marked `memoryOnlyAt`) until a relational database is configured; grants and revocations are refused on such a database (Console 503 `chat-roles-unpersisted`, chat replies "Not saved"), so a revoked migrated role cannot come back on the next start.

After the migration, configuration that names these fields **again** no longer stops startup (ADR 0060 §4.2):

- they are **never granted automatically** — whoever edits the file later is not necessarily an owner (`ops.config.write` can be granted on its own);
- the instance records them in `pendingImports` of `.zhin/chat-roles-migration.json`, then removes them from the configuration file (adapter schemas reject these fields) and logs a warning;
- the Console inbox shows `chat-roles.import-pending`; a user with **global** `iam.manage` imports or ignores each (`chat-roles.imports.list|resolve`); imports follow the first import's rules and are audited as `chat-roles.import`.

For day-to-day grants use:

- the Console: the **Roles** tab of the global / adapter / account / conversation object pages (`chat-roles.grant` / `revoke`, permission `iam.manage`);
- chat: with `features.selfService.enabled`, `role grant <user> <owner|admin|trusted> [level]` / `角色 授予 …`.

::: warning Removed, no compatibility
These fields still stop startup (`LEGACY_CHAT_ROLE_CONFIG`):

- `features.selfService.platformAdmins`, `features.selfService.roles`, `features.selfService.allowUsers`;
- `roles` of an adapter block (`roles.mappings` / `roles.inherit`) and `endpoints[i].roles` of an account — the platform standing → zhin role mapping rules were removed (see section 2).
:::

### The first global owner {#first-owner}

On a new deployment (no global `owner` at all):

- Console: the inbox shows `chat-roles.no-owner`; grant a global owner under Chat roles (global `iam.manage`). A migrated `master` is only an **account-level** owner and never becomes a global owner automatically; promote it in the Console if needed.
- Without a Console: the instance log and `zhin status` print a one-time **claim code**; the deployer sends `claim <code>` (`认领 <码>`) to the bot in a **private chat** on a real platform and becomes the global owner. The code works only while there is no global owner and the database is relational, is single-use, rotates on restart and after 5 wrong attempts, is burnt when sent in a group, and is never accepted on simulation adapters (Sandbox etc., `runtime.sandbox`). It is stored in `.zhin/chat-owner-claim.json` (mode 0600) and removed once there is an owner or the instance exits.

### Rollback (downgrading) {#rollback}

When the migration record is upgraded to version 2, the original version 1 file is kept as `.zhin/chat-roles-migration.v1.json`. Before downgrading, rename it back to `.zhin/chat-roles-migration.json` (older versions cannot read version 2 and report it as malformed). The `chat_roles` table is unchanged, so granted roles stay; older versions again stop startup on people fields in the configuration.

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
| `role(master)` | `owner`; `owner@global` for host-wide capabilities | zhin role along this conversation's scope chain; `<role>@<level>` requires that level or a higher one |
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

- **Agent security policies**: dangerous tools, file / exec policy and owner approval read the zhin role only; a **global** `owner` equals the old `master`; an owner at the adapter / account / conversation level, `admin` and `trusted` share the trusted tier. A platform group owner / admin no longer gets the trusted tier from their standing. Approval DMs go to a global `owner` with an identity on that adapter.
- **Role scope** (security review): `sender.chatRoleLevels` records where each role comes from. Host-wide capabilities (exec, files, restart, global / platform memory, scheduled runs with high trust, configuration from chat) need a global owner; adding / removing accounts needs an owner at the adapter level or above. Plugins that provide host-wide capabilities should require `owner@global` (new permit form `<role>@<level>`). Discord threads are reported as the parent channel plus `threadId`, so roles and feature settings of the channel hold in its threads.
- **Role changes in chat**: a lower grant can no longer overwrite a peer's or a higher role at the same scope; `role list` needs `admin` and hides identities granted above you. In the Console, anything touching `owner` needs a global `iam.manage`, and `chat-roles.list` redacts entries outside the caller's scope (`redacted: true`, no `adapter` / `userId`).
- **Scheduled jobs** re-read their creator's current role when they run (jobs created in IM record where the creator spoke); a plain user's job runs with group-member trust.
- **Agent pre-turn filtering**: tools / skills are disclosed for a turn only after the three-dimension check; the Bot standing is read at the start of the turn (cached), a failed lookup leaves every `bot:*` unmet; tools are checked again when executed.
- **Commands**: checked before dispatch by the same evaluator; unmet `platform:*` / `bot:*` conditions are named in the reply (e.g. 「无法执行此指令：机器人不是本群管理员（或无法确认其身份）。」); the menu lists only commands the sender can run here.
- **Group rules**: the owner / admin exemption (`exempt.ownerAndAdmins`) exempts platform owners / admins (`platform:admin`) and the zhin `owner`; a zhin `admin` is no longer exempt automatically. Rule approval still needs zhin `admin`.
- **Content moderation**: `masters` and `inbound.bypassMasters` are removed in favor of `inbound.bypass` — a list of permit expressions, any of which skips inbound review; the default is `[owner, "platform:admin"]` (moderation is a platform function: the zhin owner and platform owners / admins are exempt), `[]` reviews everyone.
- **Account management commands** (`<adapter> endpoint add|remove`) need an `owner` at the adapter level or above; restart from chat and configuration from chat need a **global** `owner`. The old "everyone may run it while no master is configured" fallback is gone.
- **Global owners**: global owners migrated from `ai.trigger.masters` have one identity per adapter, so they can use configuration from chat in private chats; an account owner (e.g. migrated from an adapter `master`) cannot.
- **Scaffolding**: the ICQQ wizard no longer asks for an owner QQ account or writes `master`; afterwards it points to the account's **Roles** tab in the Console, or `role grant <QQ> owner endpoint` sent in chat by an existing owner.
- **Testing** `@zhin.js/testing`: `createFakeMessage({ sender: { id, chatRole } })`; `PluginTestKit.receive` trusts the `sender.chatRole` / `platform` a test declares.

## 6. Adapter authors

- Report the sender's normalized platform standing on `sender.platform` of inbound messages (`PlatformStanding` from `@zhin.js/im-contract`) and declare which of `standing` / `roles` / `permissions` you report in the capability profile's `scene.platformStanding`. During the transition the Runtime still derives `platform` from the old `sender.roles` (`owner` / `admin`) and `sender.permissions`.
- When the platform can tell the bot's own standing in a conversation, implement `management.inspectSelfStanding({ conversation, signal })` (returns a `PlatformStanding` or `undefined`) and declare `scene.selfStanding`. Do not cache or call it per message: the framework caches through `AdapterIndex.selfStanding` per conversation and drops the entry on the bot's role-change events (`member.role_changed`, the bot's own `member.joined` / `member.left`). Declaring `scene.selfStanding` without the method fails at assembly.
- Tools that use `platform-permission:<name>` / `bot-permission:<name>` need the adapter to put those names into the matching standing's `permissions`.
