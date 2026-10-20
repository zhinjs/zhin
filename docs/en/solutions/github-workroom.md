---
title: "Use a GitHub repository as a Workroom"
description: "Route a GitHub repository's Issue and PR events into multi-Agent collaboration: binding, setup steps, and the boundary with GitHub Projects"
---

# Use a GitHub repository as a Workroom

A Workroom is a space where several Agents work on tasks together. This page turns one GitHub repository into one Workroom: Issues and PR comments in the repository enter the same collaboration project, where Agents plan, assign, and review the work.

For teams that want repository events to drive Agent collaboration. The Workroom rules themselves are in [Agent deep dive: Workroom Kernel](../ai/agent.md#workroom-kernel).

## One repository, one Workroom

A Workroom is identified by the **full repository address**, not by the bot. One GitHub App account (Endpoint) can therefore serve several repositories; events go to each project by `owner/repo` and never cross over.

```json
{
  "kind": "repository",
  "adapter": "github",
  "endpoint": "github-app",
  "sceneId": "zhinjs/zhin",
  "agent": "orchestrator"
}
```

## Steps

1. Install and configure the GitHub adapter, and confirm webhook events carry stable `owner/repo` information.
2. Create a project on Console's Workroom page and configure members, roles, and the coordinating Orchestrator Agent.
3. Set the collaboration space type to `repository`, choose the Endpoint, and enter the canonical repository address (such as `zhinjs/zhin`).
4. Save, then post an Issue or PR comment right away — no restart needed.
5. Check proposals and assignments on the Workroom task board, and each step in the Agent run record.

## Acceptance checklist

- Issue and PR events from one repository enter the same project.
- When one Endpoint serves several repositories, no event lands in the wrong Workroom.
- When two people edit the config at once, the later save asks for a refresh instead of silently overwriting.
- A failed GitHub Project Item sync doesn't change task state already recorded in Zhin.

## Relationship with GitHub Projects

**Task state lives in the Workroom**; a GitHub Project Item is only an optional external view. Console's task page is a read-only view of the Workroom event log (the Journal) and never changes task state directly.

::: details Want to sync tasks to GitHub Project V2?
You need a separate Integration Port that keeps an idempotent `task-key ↔ item-id` mapping and defines a conflict policy. Don't use the Item ID as the Workroom's identity, and don't let Console bypass the Workroom Kernel to write state.

Console saves Workroom config with revision CAS (compare the version, then write), which is why concurrent edits ask for a refresh.
:::

## Next steps

- [Governed software delivery](/solutions/governed-software-delivery) (Chinese only): a full plan template from requirements and independent review to CI/CD and health checks
- [Agent deep dive: Workroom Kernel](../ai/agent.md#workroom-kernel): the full Workroom fields and rules
