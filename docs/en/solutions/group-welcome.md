---
title: Welcome members only in selected groups
description: Select exact accounts and conversations, and distinguish unrestricted, empty and selected scopes
---

# Welcome members only in selected groups

The group suite's `welcomeConversations` restricts welcomes to exact Bot accounts and group conversations. It affects member-join welcomes only; check-ins, keywords, statistics and command permissions keep their own rules.

## Select an instance and a group

In Console, open **Task center → Start by use case → Configure member welcomes** (`/use-cases/group-welcome`) with a management connection. Demo does not read or modify this flow. Update Console and the Host separately; older UIs can still use plugin configuration and details directly.

The flow reads the [group suite](https://github.com/zhinjs/zhin/tree/main/plugins/utils/group-suite) package identity from the Host use-case catalog and lists its manageable instances. Select one explicitly; it never defaults to the first instance. If none is installed, open the package in Marketplace and review the exact version and existing installation plan. Merely opening Marketplace does not install it. Reconcile uncertain installation results before submitting anything again; continue with the actual instance identity returned by the Host.

1. Set `welcomeMessage`, for example `Welcome {name} ({id})`. An empty message still disables welcomes.
2. Restrict `welcomeConversations` to selected conversations. This first creates an empty scope.
3. Add an exact conversation. Read the current Host's accounts, select the actual Bot, and enter the group ID plus parent and thread IDs when present.
4. Review the summary, validate and save through the existing form, then follow the link to plugin details to request application. A draft is not active configuration.
5. Return to the welcome flow and re-read current instance and generation evidence. Once configuration semantics match, check the message, scope and full test-group identity. This still does not prove platform welcomes work.

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

## Record an actual welcome observation

Choose the complete test-group identity in the use-case page. Agree on a test with its members, have a real member join, and check the selected instance’s welcome in the original group and logs. Console does not fabricate join events, send test messages on your behalf, or treat a plain test send as proof of the join pipeline. Several instances may process one event; you must attribute the observed welcome yourself. The system does not identify its originating instance automatically.

After observing the result, select the acknowledgment and record a human confirmation. The page re-reads existing file, plugin application and generation evidence, binding the record to this instance and complete target. An empty message, empty scope, unapplied configuration or mismatched target cannot be recorded as ready. Configuration and application remain owned by the existing form and details page; the flow adds no configuration writer or verification execution API.

The result is always **human-confirmed**, not Host or platform acceptance, and is not a continuing availability guarantee. It exists only in this page’s memory and disappears on navigation or reload. A changed connection, instance, configuration, generation or full test target, or a failed evidence read, invalidates it. Read-only checks run every 10 seconds, with an observation gap.

::: warning An environment reference does not prove a nonempty message
The plugin still supports environment references. The flow reads saved source without reading or displaying expanded values. `welcomeMessage: '${WELCOME_TEXT}'` may resolve to an empty string, and references in a scope may change its actual identity. The first version conservatively treats these messages or scopes as unproven and does not let them establish readiness. Check the original configuration, environment management and real group result yourself. This is an evidence limit of the flow, not a prohibition on plugin environment variables.
:::

## Relation to Agent session welcomes (ADR 0037)

The user-facing home for group welcomes remains the group suite: configure, accept and troubleshoot `welcomeMessage` / `welcomeConversations` here ([#1012](https://github.com/zhinjs/zhin/issues/1012) A9). ADR 0037 phase 1 slice A ([#1019](https://github.com/zhinjs/zhin/pull/1019)) adds a per-session Agent template welcome, `welcome.enabled`, that passes the control plane and session gate.

One join produces one welcome (A9 option 2):

- When the conversation has the Agent session welcome `welcome.enabled` on, the group suite asks who owns the welcome before sending and stays silent. The session welcome sends the single message, with its merge window, hourly cap, control plane and session gate. `mention_only` (including the temporary cold-field mode) does not block the welcome; `emergency_stop`, `muted` and `read_only` still do, and the group suite does not send a fallback when they block it.
- When the session welcome is off (the default), or no Agent is installed, the group suite sends from `welcomeMessage` / `welcomeConversations` as before.

Enabling both therefore cannot double-send; you no longer need to enable only one per group.

The group suite sends nothing when a member leaves; leave records belong to the Agent-side audit.

## When no welcome arrives

The adapter must emit `notice.group.member_increase` with an explicit group target. Missing events or targets do not cause the plugin to guess a channel. A scope match proves neither connectivity nor delivery.

Check applied configuration, the message, exact identities and actual delivery results. An uncertain delivery is not retried automatically. Real-platform validation can send a welcome to a group and should be performed explicitly in a prepared test group.

Command `group(id)` compares conversation kind and ID only; it does not replace this full-identity allowlist. See [Console permission explanations](../paths/console.md#command-permission-explanations) for command rules.
