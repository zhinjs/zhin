---
title: Welcome members only in selected groups
description: Select exact accounts and conversations, and distinguish unrestricted, empty and selected scopes
---

# Welcome members only in selected groups

The group suite's `welcomeConversations` restricts welcomes to exact Bot accounts and group conversations. It affects member-join welcomes only; check-ins, keywords, statistics and command permissions keep their own rules.

## Select an instance and a group

Install and load the [group suite](https://github.com/zhinjs/zhin/tree/main/plugins/utils/group-suite), then open the intended instance in Console plugin configuration. One package may have several instances.

1. Set `welcomeMessage`, for example `Welcome {name} ({id})`. An empty message still disables welcomes.
2. Restrict `welcomeConversations` to selected conversations. This first creates an empty scope.
3. Add an exact conversation. Read the current Host's accounts, select the actual Bot, and enter the group ID plus parent and thread IDs when present.
4. Review the summary, validate with the Host, save and apply. A draft is not active configuration.

Platforms without group directory queries require an actual group ID entered manually. Select the complete account identity returned by the Host; never replace it with a nickname or a guessed identifier.

For manual configuration, start with an empty scope, then select targets in Console:

```yaml
configVersion: 2
plugins:
  group-suite: '@zhin.js/plugin-group-suite'
group-suite:
  welcomeMessage: 'Welcome {name} ({id})'
  welcomeConversations: []
```

## Three distinct scopes

| Configuration | Scope |
| --- | --- |
| Omit `welcomeConversations` | All matching group events received by the instance |
| `welcomeConversations: []` | No conversations |
| List complete conversations | Only exact matches, up to 100 entries |

Account, conversation kind and ID, parent, and thread all participate. Two Bots in the same group do not share the allowlist. An omitted parent or thread matches its absence, not every descendant. Duplicate entries do not cause duplicate welcomes.

Removing the last entry leaves an empty list. Restoring unrestricted coverage deletes the restriction and requires confirmation in Console. A matched welcome is sent to the event's original conversation; the allowlist never redirects it.

## When no welcome arrives

The adapter must emit `notice.group.member_increase` with an explicit group target. Missing events or targets do not cause the plugin to guess a channel. A scope match proves neither connectivity nor delivery.

Check applied configuration, the message, exact identities and actual delivery results. An uncertain delivery is not retried automatically. Real-platform validation can send a welcome to a group and should be performed explicitly in a prepared test group.

Command `group(id)` compares conversation kind and ID only; it does not replace this full-identity allowlist. See [Console permission explanations](../paths/console.md#command-permission-explanations) for command rules.
