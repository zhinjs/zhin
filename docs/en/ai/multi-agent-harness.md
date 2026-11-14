---
title: "Multi-Agent Collaboration & Venues"
description: "Declarative multi-agent collaboration, shared Blackboard, group Venues (ai.venues), and zhin trace powered by @zhin.js/harness"
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
| `agents` | List the Agents you can currently contact and what each one does |
| `ask` | Synchronously ask a peer in `contacts` and await its reply in the current turn |
| `delegate` | Asynchronously delegate work; the peer's `result` mail wakes the delegator in a new turn |
| `tell` | One-way notification to a peer without waiting for a reply |
| `follow_up` | Follow up on an earlier `ask` or `delegate` (`mailId`) within the same Engagement |
| `board_read` | Read entries from the Engagement's shared Blackboard (filter by `key` or `kind: note \| todo \| artifact`) |
| `board_write` | Write or update a `note`, `todo` (`pending \| in_progress \| done`), or `artifact` on the Blackboard |
| `cancel_delegation` | Withdraw work you delegated (pass the `mailId` returned by `delegate`) |
| `escalate` | Freeze the Engagement and escalate to the initiating human principal |

**Media from a sub-agent comes back with its reply.** Images, audio, video and files that the agent reached by `ask` / `follow_up` produced with its tools during its turn (e.g. `generate_image`) are returned to the asker as structured attachments by the framework; the sub-agent does not have to repeat URLs in its text. The asker's tool result shows only an attachment note with one-time references; the media joins the asker's reply for this turn and goes out through the normal outbound chain, so the asker does not (and should not) delegate again. At most 8 attachments per reply. Asynchronous `delegate` results carry no attachments yet.

## 3. Configure Multi-Bot Group Venues (`ai.venues`)

```yaml
ai:
  venues:
    - id: product-room
      conversation:
        platform: sandbox
        sceneType: group
        sceneId: product-room
      visibility: visible
      entry: planner
      members:
        - agent: planner
          botEndpoint: planner-bot
        - agent: builder
          botEndpoint: builder-bot
        - agent: reviewer
          botEndpoint: reviewer-bot
```

| Field | Description |
| --- | --- |
| `id` | Unique venue id |
| `conversation` | The bound conversation: `platform` (adapter platform name) and `sceneId` are required; `sceneType` (`private` / `group` / `channel`) and `threadId` are optional. One conversation can be bound to only one Venue |
| `members` | Member list; each item has `agent` (Agent name) and `botEndpoint` (the Endpoint name that Agent speaks through), plus optional `aliases` (names people can use to address it). Agents and Endpoints must be unique within a Venue |
| `entry` | The entry Agent that takes human messages when no member is addressed; must be one of the members |
| `visibility` | Projection mode; defaults to `backstage` for private chats and `visible` otherwise |

- `visible`: each participating Agent posts in the group using its bound Bot Endpoint.
- `summary`: collaboration runs backstage and only the `entry` Agent posts a summary.
- `backstage`: collaboration runs silently in the background.

See [Configuration Fields (Generated)](../configuration/generated.md) for the full field list. Remote Agents in other processes attach through [`a2a.mailbox`](../configuration/index.md#mcp-a2a).

## 4. Inspect Engagements with `zhin trace`

```bash
# List recent Engagements
zhin trace --engagements --list

# Show the collaboration graph of the latest Engagement
zhin trace --engagements

# Inspect causal hops, Blackboard entries, guard blocks, and budget usage (an id prefix is enough)
zhin trace <engagementId>
```

Collaboration events are stored in the `engagement_events` database table, which requires SQLite, MySQL, or PostgreSQL. The Workroom page in Console (`/features/ai/workrooms`) shows the same data.

See [Agent and Tool Calling](./agent.md#multi-agent-collaboration) for full details.
