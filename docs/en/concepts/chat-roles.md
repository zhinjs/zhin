---
title: Chat Roles
description: How zhin decides who may do what in chat — zhin roles owner / admin / trusted at four levels, with the sender's platform standing and the Bot's own standing as separate dimensions (ADR 0056)
---

# Chat roles

Permissions in chat consist of three **independent** dimensions ([ADR 0056](../../adr/0056-chat-roles.md)):

| Dimension | Source | Governs | Permit spelling |
| --- | --- | --- | --- |
| The sender's zhin role | grants in the `chat_roles` table (Console / chat `role grant`) | zhin functions: feature switches and settings, role management, configuration from chat, Agent trust tiers | `owner` / `admin` / `trusted`, `role(…)` |
| The sender's platform standing | `sender.platform` reported by the adapter | platform functions: who may have the bot mute, kick, change roles… | `platform:owner\|admin`, `platform-role:<id>`, `platform-permission:<name>` |
| The Bot's own platform standing | the adapter's self-standing lookup (cached per conversation) | whether a platform action can run at all: is the bot an admin here, does it hold a permission | `bot:owner\|admin`, `bot-role:<id>`, `bot-permission:<name>` |

The dimensions never convert into each other: a group owner does **not** become a zhin `admin`, and a zhin `owner` gains no platform rights. Command `permit`, Agent tool / skill / Agent package `permissions`, and middleware and button `permit` are all decided by the same evaluator.

## Platform standing

Adapters normalize the sender's standing in the group and put it on `sender.platform` of the inbound message:

```ts
interface PlatformStanding {
  standing: 'owner' | 'admin' | 'member' | 'guest';   // group owner / admin / member / guest
  roles?: { id: string; name?: string }[];            // platform-native roles (e.g. Discord roles)
  permissions?: string[];                              // platform-native permissions
}
```

Private chats carry no platform standing.

### The Bot's own standing

The same shape describes **the bot account itself** in the current conversation. When an adapter implements `management.inspectSelfStanding` and declares `scene.selfStanding` in its capability profile, the framework looks it up when needed (`bot:*` permits, the start of an Agent turn) and caches it per conversation: 60 seconds for a known answer, 10 seconds for an unknown one; the bot's role-change events drop the cache. Undeclared, private chats and failed lookups count as unknown, and every `bot:*` condition fails.

| Adapter | Support | Source |
| --- | --- | --- |
| ICQQ, OneBot 11, NapCat, Milky | groups: `standing` | `get_group_member_info` (the bot itself) |
| QQ official | groups: `standing`; channels: `standing`, `roles` | group `getBotState.member_role`; channel member roles (4 = owner, 2 = super admin) |
| Discord | channels: `standing`, `roles`, `permissions` | `guild.members.me` roles and channel permissions |
| Telegram | groups: `standing`, `permissions` | `getChatMember(bot)` |
| KOOK | channels: `standing`, `roles`, `permissions` | guild roles and permission bits from `/v3/user/view` (the bot) |
| Lark | groups: `standing` | group owner and `bot_manager_id_list` from `chat.get` |
| DingTalk and the other adapters | not supported | the platform has no lookup for the bot's own group standing |

## Three zhin roles

| Role | Meaning | Typical use |
| --- | --- | --- |
| `owner` | the bot's owner (formerly `master`) | Agent dangerous tools, owner approval, configuration from chat, restart, account management |
| `admin` | zhin administrator | in-chat feature self-service, role management, group rule approval, subscription commands |
| `trusted` | trusted user | Agent medium-risk tools |

Roles include each other: `owner` ⊃ `admin` ⊃ `trusted` — wherever `trusted` is required, `admin` and `owner` qualify too.

## Four levels

| Level | Scope key | Example |
| --- | --- | --- |
| global | `''` | every adapter |
| adapter | `<alias>` | `qq` |
| account | `<alias>/<account id>` | `qq/bot-1` |
| conversation | `<alias>/<account id>/<kind>:<id>` | `qq/bot-1/group:123` |

- A role is granted to an identity `(adapter alias, user id)` and holds in its scope and every scope below it; one person may hold different roles in different scopes.
- For every message the Runtime walks conversation → account → adapter → global, takes the highest role and writes it to `sender.chatRole`. A `chatRole` supplied by the adapter or a plugin is always dropped.
- Storage: the `chat_roles` table in the project database, loaded at startup, writes take effect immediately. zhin roles come only from these grants (including grants migrated from the old configuration).

Management:

- Console: the **Roles** tab of the global / adapter / account / conversation object pages (`chat-roles.list|grant|revoke`, needs `iam.manage`; a permission bound to an adapter / account also counts for scopes below it);
- Chat: `role list|grant|revoke <user> <role> [level]` / `角色 列表|授予|撤销 …` (with `features.selfService.enabled`). The grantor needs at least the granted role at the target scope; `owner` is granted or revoked only by an `owner` at a higher level.

::: tip A group owner who wants to manage features
Feature switches and subscriptions are zhin functions, so a platform group owner / admin needs a granted zhin role: an owner sends `role grant @owner admin` in chat, or grants it in the conversation page's **Roles** tab in the Console.
:::

## In code

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  // The sender is a group admin, and so is the bot itself
  permit: ['group()', 'platform:admin', 'bot:admin'],
  execute: () => '…',
});
```

| Spelling | Meaning |
| --- | --- |
| `owner` / `admin` / `trusted`, `role(admin,trusted)` | the sender's zhin role along this conversation's scope chain |
| `platform:owner` / `platform:admin` | the sender's normalized platform standing (`platform:admin` also accepts the owner) |
| `platform-role:<id>` / `platform-permission:<name>` | the sender's platform-native role / permission |
| `bot:owner` / `bot:admin` | the Bot's own normalized standing |
| `bot-role:<id>` / `bot-permission:<name>` | the Bot's own platform-native role / permission (e.g. `bot-permission:ban_members`) |

List entries are ANDed; comma-separated values inside one entry are ORed. When unmet:

- A command takes the existing denial path; `platform:*` / `bot:*` conditions say what is missing (e.g. 「无法执行此指令：机器人不是本群管理员（或无法确认其身份）。」), zhin role and conversation conditions keep the generic sentence; the command menu lists only commands the sender can run here.
- Agent tools / skills are never disclosed for the turn and are checked again at execution.
- Middleware is skipped for that message and the chain continues (the Bot standing is read from the cache only).
- A button callback does not run and the clicker gets the reason.

At runtime read `message.sender.chatRole` and `message.sender.platform`; `@zhin.js/core` provides `chatRoleIncludes(held, required)`, `expandChatRole(role)` and `chatRolesFromMessage(message)`; the Bot's standing comes from `AdapterIndex.selfStanding(endpointId, conversation)`. To upgrade from the old spelling see [Upgrading to chat roles](../migrations/chat-roles.md).
