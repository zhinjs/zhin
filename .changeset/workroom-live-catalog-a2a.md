---
'@zhin.js/agent': patch
'@zhin.js/a2a': patch
'@zhin.js/runtime': patch
'@zhin.js/host-http': patch
'@zhin.js/console-protocol': patch
'@zhin.js/client': patch
'@zhin.js/cli': patch
---

Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

Persist each Workroom member's Assignment locality in the Catalog. Omitted routes retain the legacy local meaning; remote routes name one exact A2A endpoint and remain deterministic when several endpoint transports are enabled. Catalog/Profile/Grant authority is rechecked before either local or remote claim, so local and remote providers can coexist without first-wins or lexicographic routing.

Replace the legacy file-backed Workroom Journal array format with content-addressed immutable v3 segments and database envelopes. The v3 schema uses an event-specific closed payload schema, stores only opaque control references beside governed payload receipts, and rejects unknown future fields before publication. Existing `.zhin/workroom-journal` data and database rows—including the blacklist-era v2 format—must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy records instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

Replace arbitrary Effect Sponsor decision `reason` text with the closed v2 `reasonCode` contract. An exact pending-Intent resubmission first publishes a content-free, digest-bound quarantine/supersession receipt, durably replaces the legacy plaintext slot with that tombstone, and then publishes to a dedicated v2 slot. Partial migrations fail closed and resume idempotently after restart, while existing v2 records in the former slot remain replay-compatible. Human rationale must use a governed payload surface and is never persisted in the content-free decision repository.

Require a full-scope token-bound principal plus current Catalog and P12 metadata authority for Portfolio Sponsor projections. Add the Root-authorized Data Steward/Privacy/Compliance Console plane for content-free lifecycle display, Hold review/release, subject erasure/export, retention purge, and reconciliation; identity and authority fields supplied by callers are rejected.

Add an optional persistent `sponsorConversation` delivery view to Workroom Catalog entries. Multiple Projects may share one portfolio-level Sponsor Room address, while controls require an explicit Project id and every outbound item remains Project-scoped. The Host bootstraps the exact current Endpoint binding before the first outbound alert; queued projections revalidate current Catalog membership/binding plus the Sponsor-specific P12 channel and manifest immediately before delivery.

Deliver content-free Portfolio lane, queue-head, grant/reclaim, budget, blocker, and fairness cards through that same governed Sponsor Room outbox. Strict Project-scoped Portfolio lane/status/budget-transfer controls use the authenticated Sponsor ingress path; a current card reply may supply the Project selector, switching Projects never rewrites a room-wide binding, and conflicting/stale explicit or reply targets are clarified without mutation.

Keep Local Assignment recovery scans independent from long-running executors, and use one locale-independent canonical comparator throughout Workroom, Portfolio, and Data Governance authority ordering.

Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.
