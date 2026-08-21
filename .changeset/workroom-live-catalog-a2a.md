---
'@zhin.js/agent': major
'@zhin.js/a2a': minor
'@zhin.js/runtime': minor
'@zhin.js/host-http': minor
'@zhin.js/console-protocol': minor
'@zhin.js/client': minor
'@zhin.js/cli': major
---

Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

Replace the legacy file-backed Workroom Journal array format with content-addressed immutable segments. Existing `.zhin/workroom-journal` data must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy segments instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.
