---
title: Structured storage and usage queries
---

# Structured storage and usage queries

With Agent enabled and SQLite, MySQL or PostgreSQL configured, the runtime persists turn and model-call usage independently of log level, Workroom and trace archives. The Console database page can inspect these tables. Charts, statistics commands and a dedicated query API are not included yet.

```yaml
ai:
  usage:
    retentionDays: 30
```

The retention period must be a positive integer. It defaults to 30 days. Cleanup runs at startup and hourly, removing each root turn and its calls together according to the root turn's completion time. This does not change message, session, task or ordinary log retention.

## Tables and counting

`agent_usage_turns` stores one root turn: owner, trace/turn/session identifiers, principal, origin, complete conversation address, selected model, outcome, timestamps, duration and call count. `agent_usage_calls` stores each reported model response: root ID, actual child turn, call sequence, provider/model, stop reason, duration and numeric input/output/total, cache-read/write and reasoning tokens. Join calls to turns on `root_id = id`.

Synchronous child calls belong to the same root and retain their own turn IDs. Do not add parent counts to detail counts. Unknown usage is `NULL`; only a proven zero is `0`. Return both totals and known sample counts:

```sql
SELECT provider, model, COUNT(*) AS calls,
       COUNT(input_tokens) AS calls_with_input,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens
FROM agent_usage_calls
GROUP BY provider, model;
```

Cache tokens are input components; reasoning tokens are output components. These are provider-reported facts, not a billing ledger. Independent calls outside the turn event chain and failures without usage are not estimated. Records commit atomically when a turn ends, so an unfinished turn lost in a process crash may have no final record. Persistence failure logs `op=usage_persist status=failed` without changing delivery or repeating the model call.

Usage tables contain no chat body, prompt, reasoning text, tool arguments/results or exception body. Identity columns still contain business data and follow existing database/Console access controls.

## Messages, sessions and tasks

- `conversation_events`: event type, exact endpoint, conversation, parent, thread, actor and platform message ID; original event JSON and cursors remain intact.
- `agent_messages`: actor, turn/intent, provider/model, stop reason and tool-result dimensions; payload, extensions and message-tree relationships remain intact.
- `agent_sessions`: provenance at creation, without changing session routing or authorization. Unprovable historical provenance stays `NULL`.
- `unified_inbox_message`: direction, canonical endpoint and thread alongside the original Console content/raw fields.
- `agent_schedule_jobs`: schedule, creator, target, status and execution result as columns. Variable lists and event/schedule extensions remain explicitly named `*_json` fields.
- Reminder/RSS owner-scoped tables separate tasks, operation receipts, seen article IDs and pending summary items. `*_book` rows hold revisions and migration markers, not a JSON task book. All rows and claims commit in one transaction. Unknown deliveries are never automatically resent; RSS baseline/resume and pause behavior is unchanged.

Identity columns use reversible `k1:` encoding (`%` → `%25`, NUL → `%00`) because canonical endpoint IDs may contain NUL, which PostgreSQL text rejects. Use `encodeStorageIdentity` / `decodeStorageIdentity` from `zhin.js/plugin-runtime`. Null and empty string remain distinct. Task free text uses the same encoding; provider/model and status fields remain plain text.

## Upgrade

Stop the old process and back up the database and `data/schedule-jobs.json` before upgrading. Perform a full restart to register the new task tables. Do not run old and new writers against the same task storage.

Message migrations are additive and backfill in batches, preserving old columns, message trees and summary anchors. Malformed canonical records fail migration without deleting originals. Reminder/RSS import old CAS keys transactionally, then remove the old keys; durable markers prevent resurrection. Agent imports the old schedule file once and preserves the file, but SQL becomes authoritative. Invalid or unsupported files fail migration.

MongoDB, Redis and memory retain existing session capabilities. They do not gain structured usage or transactional task tables in this change, and emit an explicit unsupported diagnostic without switching databases. Existing Agent file-mode tasks retain their original storage.

The `database-live` CI job validates SQLite and both single-connection and pooled MySQL/PostgreSQL storage. This is database validation, not live IM delivery acceptance.
