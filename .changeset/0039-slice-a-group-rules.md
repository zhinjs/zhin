---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0039 slice A: add the `ai_group_rules` table and `AiGroupRules` store for dynamic group-ops rules — `draft → pending → active` with `rejected` / `expired` / `disabled` side states, optimistic `revision`, a canonical `content_hash` (any edit returns to draft), at most one active rule per group and trigger (approving a new one supersedes the old), and 24 h approval expiry. Adds audit kinds `group_rule` / `rule_enforcement` and the `rule_*` reason codes. Storage is bounded: per-field limits, at most 20 open drafts per group, terminal rows lose their summary immediately and are deleted after 30 days or beyond 50 per group (on startup and hourly). No behaviour change yet: drafting tools, approval cards and the executor land in later slices.
