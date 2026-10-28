---
title: "Operator & Group Admin Guide"
description: "For operators and group owners: manage your bot with Console and configuration, no TypeScript — connect, change settings, install features, welcomes, announcements and approvals, and when to call a developer"
---

# Operator & Group Admin Guide

This page is for **operators, group owners, and community / support leads**: you keep the bot working well in your groups, but you don't write TypeScript. Everything you need lives in the browser-based **Console** and one configuration file.

::: tip Is this page for you?
- **Yes** if you want welcomes, check-ins, reminders, feed pushes or content moderation in your groups, want to see what the bot is doing, and want to check problems yourself first.
- **No** if you want to write new commands, plugins or platform adapters — that's developer work; see the [developer quick start](/en/getting-started/).
:::

## What Zhin does for you {#what-you-get}

| Outcome | How | Code needed? |
| --- | --- | --- |
| One bot managing groups on QQ, WeChat, WeCom, Lark, Discord and more | A developer deploys once; you watch everything under Console → chat accounts | No |
| Welcome new members, only in selected groups | [Group welcome guide](/en/solutions/group-welcome) | No |
| Check-in points, message stats, group Q&A / keyword replies | Install the group suite `@zhin.js/plugin-group-suite` from the feature store | No |
| Scheduled and event reminders | [Reminders without AI](/en/solutions/reminders) | No |
| Push feed updates into a group | [Admin RSS subscriptions](/en/solutions/rss-subscriptions) | No |
| Block ads, abuse and other unwanted content | Install `@zhin.js/plugin-content-moderation` | No |
| An AI assistant that chats and answers business questions | A developer enables AI; you observe and stop it from Console | Developer for setup |
| Announcements that only go out after a human approves; risky admin actions gated | See [Group ops, announcements and approvals](#group-ops) | No |

Not sure yet? Open the [online demo](https://demo.zhin.dev) to see Console (the demo is read-only).

## Connect Console {#connect-console}

Console is a standalone web app; you don't deploy it:

1. Ask whoever deployed the bot for two things: the **API address** (e.g. `http://127.0.0.1:8068` or your domain) and the **token** (`HTTP_TOKEN` in the project's `.env`).
2. Open [console.zhin.dev](https://console.zhin.dev) and enter both.
3. When the accounts (Endpoints) on the home page show online, you're connected.

::: warning The token is a password
Never paste it in a group, a screenshot or a link. A **Full token** can send messages and change config; a **Demo token** can only read. Colleagues who only watch status need nothing more than a Demo token.
:::

No running bot yet? A developer or ops person does this once: create a project with the [quick start](/en/getting-started/) or go live with [Deployment and Recovery](/en/operations/production). Day-to-day operations then happen in Console.

## Daily operations: find the right page {#daily}

| I want to… | Console page |
| --- | --- |
| Check health and which account is offline | Home |
| Message a group or DM, see recent messages | Chat accounts |
| Review what the bot said | Chat history |
| Try replies without a real platform | Try chatting (Sandbox) |
| See why the AI replied or stayed silent, and which tools it used | Bot status (incl. decision replay) |
| Make the bot go quiet now | Bot status → control plane (see [Emergency stop](#stop)) |
| Manage scheduled reminders | Reminders |
| Install or disable features | Feature store, feature management |
| Follow a guided setup (e.g. new-member welcome) | Task center → start by use case |
| Investigate errors | Run log |

Details for every page: [Console path](/en/paths/console) and [Console reference](/en/console/).

## Change settings without code {#no-code-config}

The bot's behavior comes from one file, `zhin.config.yml`. You don't need to edit it by hand:

- **Install features** from the feature store; enable or disable them in feature management.
- **Change feature settings** in each plugin's form — welcome text, check-in points, keyword limits. The form follows the fields the plugin declares and won't save malformed values.
- **Secrets** such as platform credentials and model keys go in Advanced → environment variables, not in regular config.
- **Confirm it applied**: a successful save is not the same as live. Follow the page's distinction between "restart required" and "plugin config pending verification", use "read apply evidence" when needed, and treat the runtime capabilities page as the source of truth.

::: details Comfortable with a terminal?
In the bot's project folder, `npx zhin setup` adds platforms, AI and a database through a wizard; `npx zhin doctor` diagnoses ports, tokens and config. All fields: [Configuration](/en/configuration/).
:::

## Group ops, announcements and approvals {#group-ops}

Zhin's rule: **every bot decision is traceable, risky actions need approval, and you can stop everything with one switch.**

### Welcomes and group operations

- **Welcome new members**: the group suite's welcome is off by default and only sends once you set a welcome text; you can limit it to selected groups. See [Welcome only selected groups](/en/solutions/group-welcome).
- **Check-ins, stats, Q&A**: after installing the group suite, members use commands such as `checkin` and `stats`; **only group owners, admins or trusted users** can change keywords and Q&A.
- **Content moderation** scans inbound and outbound messages and blocks or masks them by severity.

### Announcements: draft → approve → send

- The AI may **draft** an announcement, but it can't submit, approve or send it.
- It goes out only after someone with approval rights (Console permission `ops:approve`) approves; editing the text after approval blocks the send.
- Pending drafts expire after 24 hours; failed sends are never retried silently — Console shows why, and a resend needs a fresh approval.

### Approving risky actions

For risky actions such as kicking a member, messaging another group or changing config, the bot only creates an **approval card** for an authorized person to approve or deny. The same action in the same group has a cooldown, so repeated clicks produce one card. In groups you can choose approval scopes like "this time only / this conversation / always"; see [AI approvals](/en/ai/#ai-agent).

### Emergency stop {#stop}

The control plane under Bot status has four switches, per bot or per group, kept across restarts:

| Switch | Effect |
| --- | --- |
| Emergency stop (`emergency_stop`) | No model calls, no outbound messages (including scheduled ones) |
| Muted (`muted`) | The bot doesn't speak |
| Read-only (`read_only`) | No write actions |
| Mention only (`mention_only`) | Replies only when @-mentioned or in DMs |

The AI has no way to turn these switches off. Every block and change is recorded in decision replay, so you can see who changed what and when.

::: info Current status
Announcements, conversation welcomes, conversation schedules and the control plane are provided by the bot (Host); some matching Console pages are still rolling out, and older Console versions may not show them. If you can't find one, update Console or ask a developer. Rule-based **automatic muting** ("dynamic group rules") is still planned ([#1050](https://github.com/zhinjs/zhin/issues/1050)); today all admin actions need human approval.
:::

## Check problems yourself first {#troubleshooting}

1. **Home**: is the bot connected and are accounts online?
2. **Chat accounts**: did the member's message reach the bot? Open that message's "Diagnostics".
3. **Runtime capabilities**: is the relevant feature loaded?
4. **Bot status**: how far did the AI get, and why didn't it reply?

More in [Find where a message stopped](/en/troubleshooting/messages) and the [Troubleshooting center](/en/troubleshooting/).

## When to call a developer {#when-to-call-a-developer}

| Situation | Why |
| --- | --- |
| First deployment, moving servers, major upgrades | Needs the command line and server access; see [Deployment and Recovery](/en/operations/production) and [Compatibility and Migration](/en/operations/upgrades) |
| A new command or feature no existing plugin provides | Needs a plugin; see [First plugin](/en/getting-started/first-plugin) |
| A platform with no adapter yet | Needs an adapter; see [Adapter authoring](/en/authoring/adapters) |
| Letting the AI call your business systems | Needs AI tools; see [Agent tools](/en/authoring/agent-tools) |
| Console can't connect, CORS errors, reverse proxy issues | Needs server config; see [Deployment and Recovery](/en/operations/production) |
| Errors in the run log you can't interpret | Send the error and time to a developer; see the [Troubleshooting center](/en/troubleshooting/) |

When you reach out, include: which group, when, what you expected, what actually happened, and a screenshot of Bot status or the run log (hide the token).

## Further reading

- [What is Zhin.js](/en/getting-started/introduction): a 5-minute overview
- [Console path](/en/paths/console): every Console page in detail
- [Choose by outcome](/en/solutions/): find a solution by the result you want
- [Multi-platform community bot](/en/showcase/community-bot): a real example
