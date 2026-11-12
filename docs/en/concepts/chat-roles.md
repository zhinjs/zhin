---
title: Chat Roles
description: How zhin decides who may do what in chat — normalized platform identity, the owner / admin / trusted roles, four levels and mapping rules (ADR 0056)
---

# Chat roles

Permissions in chat follow one model ([ADR 0056](../../adr/0056-chat-roles.md)): the sender's effective chat role in **this conversation**, plus the **platform identity** the adapter reports. Command `permit`, Agent tool `permissions`, Agent security policies, group rules, content moderation and in-chat self-service all read these two things.

## Platform identity

Adapters normalize the sender's standing in the group and put it on `sender.platform` of the inbound message:

```ts
interface PlatformStanding {
  standing: 'owner' | 'admin' | 'member' | 'guest';   // group owner / admin / member / guest
  roles?: { id: string; name?: string }[];            // platform-native roles (e.g. Discord roles)
  permissions?: string[];                              // platform-native permissions
}
```

Private chats carry no platform identity. A platform identity is **not** a chat role by itself: a group owner cannot use `owner` commands for being a group owner; it only counts once a mapping rule turns it into a role.

## Three roles

| Role | Meaning | Typical use |
| --- | --- | --- |
| `owner` | the bot's owner (formerly `master`) | Agent dangerous tools, owner approval, configuration from chat, restart, account management |
| `admin` | administrator | in-chat feature self-service, group rule approval, conversation management commands |
| `trusted` | trusted user | Agent medium-risk tools |

They include each other: `owner` ⊃ `admin` ⊃ `trusted` — wherever `trusted` is required, `admin` and `owner` qualify.

## Four levels

| Level | Scope key | Example |
| --- | --- | --- |
| global | `''` | every adapter |
| adapter | `<alias>` | `qq` |
| account | `<alias>/<account id>` | `qq/bot-1` |
| conversation | `<alias>/<account id>/<kind>:<id>` | `qq/bot-1/group:123` |

- A role is granted to an identity `(adapter alias, user id)` and holds at its scope and every scope under it; one person may hold different roles in different scopes.
- For every message the Runtime walks conversation → account → adapter → global, takes the highest role and writes it to `sender.chatRole`. Any `chatRole` an adapter or plugin supplied is dropped.
- Storage: the project database table `chat_roles`, loaded at start, effective immediately on write.

Where to manage them:

- Console: the **Roles** block on adapter / account / conversation pages (`chat-roles.list|grant|revoke`, permission `iam.manage`; bindings scoped to an adapter / account count for the scopes under it);
- chat: `role list|grant|revoke <user> <role> [level]` / `角色 列表|授予|撤销 …` (with `features.selfService.enabled`). The grantor needs at least the granted role at the target scope; `owner` can only be granted or revoked by an `owner` at a higher level.

## Mapping rules {#mappings}

Mapping rules turn a platform identity into a role of **the message's conversation**, computed live for every message and never stored — revoke someone's admin on the platform and the zhin role disappears with it.

```yaml
qq:
  roles:
    mappings:
      - match: { standing: [owner] }        # or { role: ['<platform role id>'] } / { permission: [ban_members] }
        grant: admin
```

| Level | Where | May grant |
| --- | --- | --- |
| default | built in | `standing: [owner, admin]` → `admin` |
| adapter | adapter block `roles` | `admin` / `none` |
| account | `endpoints[i].roles` | `admin` / `none` |
| conversation | database (Console conversation page, `chat-roles.set-mappings`) | `owner` / `admin` / `trusted` / `none` |

- Lower levels add rules or override a rule with the same `match` from above; `grant: none` removes an inherited rule with the same `match`; `inherit: false` drops every rule from above, the default included.
- Every criterion given in `match` must hold; any value within one criterion matches.
- Mapping to `trusted` / `owner` needs an explicit conversation-level rule; mappings never yield a role at the account level or above.
- `chat-roles.mappings` returns the rules of every level and the merged result; `source: 'mapping'` entries of `chat-roles.list` (recently seen senders) carry a `detail` naming the rule.

::: tip Default mapping and Agent permissions
The default rule makes group owners / admins `admin` of their conversation, and `admin` includes `trusted`, so they can use the Agent's medium-risk tools in that group. Turn the default off (`roles: { inherit: false }` in the adapter block) or tighten it if you do not want that.
:::

## In code

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  permit: ['group()', 'admin'],        // admin of this conversation (owner included)
  execute: () => '…',
});
```

| Spelling | Meaning |
| --- | --- |
| `owner` / `admin` / `trusted`, `role(admin,trusted)` | chat role along this conversation's scope chain |
| `platform:owner` / `platform:admin` | normalized platform standing (`platform:admin` also accepts the owner) |
| `platform-role:<id>` | platform-native role id |
| `platform-permission:<name>` | platform-native permission |

At run time read `message.sender.chatRole` and `message.sender.platform`; `@zhin.js/core` provides `chatRoleIncludes(held, required)`, `expandChatRole(role)` and `chatRolesFromMessage(message)`. To upgrade from the old spellings see [Upgrading to chat roles](../migrations/chat-roles.md).
