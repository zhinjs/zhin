---
title: GitHub Repository Workroom
---

# Treat one GitHub repository as one Workroom

Use this when repository events should enter a multi-Agent collaboration flow. One repository naturally maps to one Project Workroom; Issue and pull-request comments share that Project boundary.

## Identity model

The full `repository` address identifies the Workroom, not the Bot. One GitHub App Endpoint may serve multiple Workrooms. Stable `owner/repo` metadata routes an event to the correct Project Inbox.

```json
{
  "kind": "repository",
  "adapter": "github",
  "endpoint": "github-app",
  "sceneId": "zhinjs/zhin",
  "agent": "orchestrator"
}
```

## Implementation

1. Install and configure the GitHub adapter. Verify Webhooks carry stable `owner/repo` metadata.
2. Create a Project in Console Workrooms and assign members, roles, and an Orchestrator Agent.
3. Set the collaboration space to `repository`, choose the Endpoint, and enter the canonical repository address.
4. Save the Catalog and send an Issue or pull-request comment. No Host restart is required.
5. Inspect proposals, Assignments, and Journal facts on the Workroom Task board, then open the Agent trace for execution details.

## Task versus Project Item

A Zhin Task is a Workroom Kernel fact. A GitHub Project Item is only an external projection target. The current Console Task page is a read-only Journal and Kernel view; it does not mutate task state.

Project V2 sync needs a separate Integration Port, idempotent `task-key ↔ item-id` mapping, and a conflict policy. Never use an Item ID as Workroom identity or let Console bypass Kernel state transitions.

## Acceptance

- Issue and pull-request events from one repository enter one Project.
- One Endpoint can serve multiple repositories without cross-routing events.
- Catalog edits publish through revision CAS; concurrent edits request a refresh instead of overwriting silently.
- Project Item sync failure cannot alter committed Kernel facts.

See [Agent deep dive: Workroom Kernel](/en/ai/agent#workroom-kernel) for the full fields.
