---
title: Governed Business Agent
---

# Give an Agent business context without excess authority

Use this when an Agent needs internal vocabulary, output rules, and business tools. The result is hot-reloadable context, explicit tool authority, risk approval, and replayable runs.

## Four independent control planes

| Plane | Owns | Does not own |
| --- | --- | --- |
| Prompt Section | Vocabulary, rules, and tool guidance | Tool or data authority |
| Tool Feature | Input schema, execution, and model output | Host execution policy |
| `approval` | Which calls require a person | Tool visibility |
| `ai.agent` | Execution preset, allowlist, and iteration limit | Prompt content |

## Implementation

1. Declare required or optional sections under `agent/prompt-sections/` with explicit budgets.
2. Expose minimal tools under `agent/tools/` with structured schemas. Side-effecting tools must not bypass approval by default.
3. Start with `execSecurity: deny` or `allowlist`; permit only required commands in known working directories.
4. In Console Runtime Capabilities, inspect Prompt Section owner, source, profile, and budget policy.
5. Run one read-only and one side-effecting task in Agent Studio. Verify approval, cancellation, trace, and artifacts.

## Acceptance

- A failed reload cannot change the fixed Prompt Section snapshot of an active turn.
- Console proves that a section entered the current generation without exposing content or metadata.
- A cancelled tool is not projected as a normal completion; side effects remain auditable.
- Working directory and security policy are explicit run inputs, never elevated from chat text.

See [Agent tools and Prompt Sections](/en/authoring/agent-tools) and [Agent deep dive](/en/ai/agent).
