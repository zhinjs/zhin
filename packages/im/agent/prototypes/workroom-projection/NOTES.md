# Prototype verdict

Decision-map ticket #5 is answered.

- Direction remains consistent with #1–#4: Kernel Journal is the only state authority; IM/Console are rebuildable projections; Workroom human input enters only Orchestrator; accepted state and TaskInput disposition are not inferred from chat text.
- Existing canonical `ConversationRef`, ConversationEventStore, MessageRef and DeliveryReceipt are reusable. The production gap is a Space Router before current AI trigger plus Agent-owned binding/outbox/message-index storage.
- Binding migration is sequence-anchored, so delayed messages cannot cross from an old Space into a new one.
- Console keeps every disclosure-approved observable fact. Workroom IM uses fixed closed windows for progress and immediate attention/conclusion events; each projection retains source fact IDs.
- A single Bot renders logical Agent/Assignment identity. Multiple Bots are delivery mappings only and never select Orchestrator/Executor authority.
- Replies resolve durable message provenance. Logical mentions resolve against a Project Agent Directory. Ambiguous/aggregate targets require clarification; historical Assignments become rework discussion, never a direct specialist Turn.
- Projection delivery is at-least-once and independent from Kernel progress. Failure/retry/duplicate/echo affect display only; all sends use the unified outbound chain.
- Sponsor Room read queries may aggregate, but writes require exactly one explicit or reply-derived Project plus authority recheck, then become a target Kernel proposal.
- `scenarios.ts` passed Space routing, migration anchor, curated/lossless sinks, stable progress coalescing, logical identity, failed delivery retry, echo suppression, exact/historical reply, exact/ambiguous alias and Sponsor targeting.

Deferred without changing #5 facts: #11 owns Portfolio capacity/priority arbitration; #12 owns disclosure/redaction/retention vocabulary; Console UI presentation can evolve over this stable projection contract.
