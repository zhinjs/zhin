# @zhin.js/harness

## 1.0.1

### Patch Changes

- 3a8504b: ADR 0048 Agent Harness (H1–H2): new `@zhin.js/harness` package (attenuated authority, conserved budgets, guard kernel, engagement journal, mailbox). Live turns now collaborate with other agents through the `agents` / `ask` / `delegate` / `tell` / `cancel_delegation` / `escalate` tools instead of `spawn_task`; `agent.json` gains `collaboration: { contacts, accepts_from }`. The sub-agent runtime, deferred workers, detached tasks and their config fields are removed.
- d3a297d: ADR 0048 H3 (PR-1): mailbox inbox policies. `MailboxKey` gains `lane` (a mail's `lane`, default its engagement), and `BatchPolicy` is replaced by `InboxPolicy { onPost, ready, staleOf }` with an injectable clock and timer, queue TTL, `cancelSender`, and a turn control (`markDelivered` / `markActed` / `staleCheck`, admission facts) passed to the runner. `MailBody.human` gains optional `senderId` / `senderName` / `plainText` / `mergeable` / `live` / `isMaster` / `isStop` markers. New `createInboxPolicy` ports the admission, queue, merge-window, stale-reply and danmaku semantics of `TurnAdmissionGate`. It also adds the merged-turn helpers `participantsOf`, `firstHumanPrincipal` and `mergedAuthority`. The IM runtime is not switched over yet.
- c563f3b: ADR 0048 H3 PR-2: every IM / ZhinAgent turn is a Mail turn of a long-lived host Mailbox. Same-session admission (#725), the ADR 0038 merge / danmaku windows, stale-reply checks and supersede are now the harness inbox policy; scene-event wakes post one event Mail on the scene lane. The mid-turn delivery API is `harness.deliver` (`open` is the same call). `TurnAdmissionGate`, `InboundTurnQueue` and `harness.attach` are removed.

  **Breaking config rename:** `ai.agent.inboundQueue` is now `ai.agent.mailbox` (same `groupMode` / `ttlMs` / `maxQueuedTurns` / `merge` / `live` fields; `coalesceWindowMs` is dropped). A config that still sets `ai.agent.inboundQueue` fails startup validation with a migration message.

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
