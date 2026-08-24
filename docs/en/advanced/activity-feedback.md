---
title: Activity Feedback
---

# Activity Feedback

`@zhin.js/service-activity-feedback` projects Agent execution state into the originating IM conversation, so users can see that work is still progressing.

## What it covers

- Main Agent queueing, processing, thinking, and terminal cleanup.
- Tool and task iterations, including status updates such as “Calling tool: web_search…”.
- Isolated sub-Agent feedback keyed by `agentId + taskId`.
- Schedule start plus transient success or failure results.

Events are serialized within one IM conversation. Different conversations still run concurrently.

## Install and mount

```bash
pnpm add @zhin.js/service-activity-feedback @zhin.js/agent
```

Add the plugin to `package.json#zhin.plugins`:

```json
{
  "zhin": {
    "plugins": [
      {
        "package": "@zhin.js/service-activity-feedback",
        "instanceKey": "activity-feedback"
      }
    ]
  }
}
```

## Configure it

```yaml
plugins:
  activity-feedback:
    enabled: true
    defaults:
      phases:
        active:
          private: { type: message, message: "Working…" }
    platforms:
      discord:
        phases:
          active:
            channel: { type: typing }
    endpoints:
      "discord:operations":
        phases:
          queued:
            channel: { type: reaction, emoji: "⏳" }
```

Layers merge in this order: `defaults → platforms.<platform> → endpoints.<platform:endpointKey>`. Each phase can configure `private`, `group`, and `channel` independently.

## Phase quick reference

A `phase` is a fixed Agent lifecycle state, not an arbitrary label. The Schema accepts exactly these six values:

| phase | When it appears | When it stops | Beginner recommendation |
| --- | --- | --- | --- |
| `queued` | A request is queued but execution has not started | Processing starts or the queue entry is cleared | Use a lightweight `reaction` under high concurrency; otherwise `none` is reasonable |
| `active` | The Agent is processing, iterating, or calling tools | The turn completes, fails, is cancelled, or switches to `thinking` | Prefer `typing`; use a removable `message` when native typing is unavailable |
| `thinking` | The model emits reasoning, continues after a tool, or a sub-Agent is working | Processing resumes or the turn/subtask ends | Use editable `message` text when supported; otherwise `typing` or `reaction` |
| `schedule_start` | A Schedule Job with activity feedback starts | The Job succeeds or fails | Prefer a `message` so unattended work has an explicit start record |
| `schedule_finish` | A Schedule Job succeeds | It is a transient terminal state removed after `removeDelay` | Use a success `message`; the common display time is 3 seconds |
| `schedule_error` | A Schedule Job fails | It is a transient terminal state removed after `removeDelay` | Use a visible failure `message` and increase `removeDelay` when operators need time to notice |

The first three phases are for interactive turns. The last three are for Schedule Jobs that explicitly enable `activityFeedback`. Schedule shorthand keys `start`, `finish`, and `error` map to `schedule_start`, `schedule_finish`, and `schedule_error`:

```yaml
plugins:
  activity-feedback:
    schedule:
      phases:
        start:
          group: { type: message, message: "⏰ Scheduled task started" }
        finish:
          group: { type: message, message: "✅ Scheduled task complete", removeDelay: 3000 }
        error:
          group: { type: message, message: "❌ Scheduled task failed", removeDelay: 10000 }
```

## Scenes and presentation types

Each phase accepts exactly three scene keys:

- `private`: direct or one-to-one conversations.
- `group`: group conversations.
- `channel`: server or workspace channels.

Each scene's `type` accepts exactly four values:

| type | Related fields | When to recommend it |
| --- | --- | --- |
| `reaction` | `emoji` | Low-noise group feedback when the Endpoint supports reactions |
| `typing` | no required extension field | The default when the platform exposes native typing |
| `message` | `message`, optional `removeDelay` | Explicit text, dynamic updates, or Schedule terminal states |
| `none` | none | Disable one phase or scene completely |

`autoRemove` defaults to `true`. `removeDelay` is measured in milliseconds; the runtime normalizes negative values to `0`. See the [generated configuration field reference](/en/configuration/generated#activity-feedback) for the complete field, enum, and default contract.

Runtime execution follows the Endpoint `operations` declaration. Unsupported requests fall back only to a safely removable `reaction`, `typing`, `message`, or `none`; the service never calls an undeclared hidden capability or invents a platform message ID.

## Schedule eligibility

The Schedule Job must enable `activityFeedback`, and its notification target must resolve to an IM conversation:

```yaml
activityFeedback: true
notify:
  channel: im
```
