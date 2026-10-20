---
title: "Teach an Agent your business without widening its authority"
description: "Give an Agent internal terms, output rules, and business tools, while separate tool permissions, approvals, and execution policy control what it can do"
---

# Teach an Agent your business without widening its authority

For teams that want to hand internal vocabulary, output rules, and business tools to an AI. The goal: business context can be hot-updated at any time, while what the AI may call, which operations need a human, and which commands it may run are controlled by separate settings — and every run can be reviewed afterwards.

## Four settings, one job each

The key point: **nothing written into a prompt grants the AI any permission.** Permissions are controlled in three other places.

| Setting | Owns | Does not own |
| --- | --- | --- |
| Prompt Section | Vocabulary, rules, tool-usage hints | Does not grant tool or data access |
| Tools (`tools/`) | Input format, execution, result returned to the model | Does not decide command execution policy |
| `requiresApproval` | Which calls need human confirmation | Does not widen which tools are visible |
| `ai.agent` | Command execution preset, allowlist, iteration limit | Does not change prompt content |

## Steps

1. Write business context in your plugin's `prompt-sections/`, mark it required (`required`) or optional, and keep it within budget. See [Give the AI business context](../authoring/agent-tools.md#give-the-ai-business-context).
2. Expose only the tools you need in `tools/`, with structured input schemas; don't set tools that change data to "never needs approval".
3. Start command execution at `execSecurity: deny` or `allowlist`, and open only the commands you need in known working directories.
4. After startup, check source, profiles, and budget policy under **Runtime Capabilities → Prompt Sections** in Console.
5. In the Agent workbench, run one read-only task and one task with side effects, and confirm approval, cancellation, the run record, and outputs behave as expected.

## Acceptance checklist

- If a context change fails to hot-reload, conversations in progress keep the content they started with.
- Console shows the Prompt Section is active without exposing its text.
- A cancelled tool call is never shown as completed; results with side effects are auditable.
- Each run explicitly chooses its working directory and security policy; a line of chat text can't escalate them.

## Next steps

- [Agent Tools and Skills](../authoring/agent-tools.md): tools, Prompt Sections, and approval in full
- [Agent deep dive](../ai/agent.md): how a turn runs and how to cancel it
