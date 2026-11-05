---
title: "Multi-Agent Collaboration & Venues"
description: "Declarative multi-agent collaboration, shared Blackboard, group Venues (ai.venues), and zhin trace powered by @zhin.js/harness"
sidebar: false
---

# Multi-Agent Collaboration & Venues

Zhin.js uses **Agent Harness** ([ADR 0048](../../adr/0048-agent-harness.md)) as its multi-agent collaboration microkernel: the framework enforces monotonic authority attenuation, a conserved budget ledger, deterministic Guard Kernel checks, per-actor serial Mailboxes, a shared Blackboard, and the `engagement_events` Journal.

## 1. Declare `collaboration` in `agents/<name>/agent.json`

```json
{
  "name": "planner",
  "version": "1.0.0",
  "description": "Entry orchestrator that coordinates builder and reviewer",
  "role": "orchestrator",
  "entry_points": ["system.md", "boundaries.md", "conventions.md"],
  "trigger_rules": {
    "file_patterns": [],
    "keywords": ["plan", "design"]
  },
  "collaboration": {
    "contacts": ["builder", "reviewer"],
    "accepts_from": ["human", "builder", "reviewer"],
    "budget": {
      "modelCalls": 16,
      "tokens": 64000,
      "wallMs": 120000,
      "sideEffects": 8
    }
  }
}
```

## 2. Collaboration Tools & Shared Blackboard

| Tool | Purpose |
| --- | --- |
| `ask` | Synchronously ask a peer in `contacts` and await its reply in the current turn |
| `delegate` | Asynchronously delegate work; the peer's `result` mail wakes the delegator in a new turn |
| `tell` | One-way notification to a peer without waiting for a reply |
| `follow_up` | Follow up on an earlier `ask` or `delegate` (`mailId`) within the same Engagement |
| `board_read` | Read entries from the Engagement's shared Blackboard (filter by `key` or `kind: note \| todo \| artifact`) |
| `board_write` | Write or update a `note`, `todo` (`pending \| in_progress \| done`), or `artifact` on the Blackboard |
| `escalate` | Freeze the Engagement and escalate to the initiating human principal |

## 3. Configure Multi-Bot Group Venues (`ai.venues`)

```yaml
ai:
  venues:
    - id: product-room
      adapter: sandbox
      scene: group:product-room
      mode: visible
      entry: planner
      participants:
        planner: sandbox:planner-bot
        builder: sandbox:builder-bot
        reviewer: sandbox:reviewer-bot
```

- `visible`: each participating Agent posts in the group using its bound Bot Endpoint.
- `summary`: collaboration runs backstage and only the `entry` Agent posts a summary.
- `backstage`: collaboration runs silently in the background.

## 4. Inspect Engagements with `zhin trace <engagement>`

```bash
# List recent Engagements
zhin trace

# Inspect causal hops, Blackboard entries, guard blocks, and budget usage
zhin trace <engagementId>
```

See [Agent and Tool Calling](./agent.md#multi-agent-collaboration) for full details.
