# Ticket #11 prototype notes

Decision-map ticket #11 is answered by the executable model in this directory.
These files are evidence for the decision, not a second production scheduler.

## Facts established

- The Workroom Scheduler remains Project-local and publishes only one or more
  locally ordered, opaque `Capacity Request` heads. Portfolio never reads the
  Project queue or chooses a Task inside it.
- A request contains an atomic Resource Bundle. Model, executor and rate
  reservations cannot be partially granted and deadlock while waiting for the
  rest of the bundle.
- A `Capacity Grant` is a versioned, fenced lease pinned to the Portfolio and
  Project policy revisions at issue time. It grants resource use, not Task
  authority, Tool authority, or a new capability absent from the Run Profile.
- Sponsor lane and exact-request Priority Override express cross-Project intent.
  Weighted dominant historical service provides fair share within a lane;
  persisted starvation deadlines outrank lane at the next capacity opportunity.
- Starvation is bounded by capacity opportunities, not by impossible wall-clock
  promises. Atomic work completes or loses its finite lease. Checkpointable work
  uses a two-phase reclaim request handled by the owning Workroom Kernel.
- Budget and rate are reserved before a grant. An unconsumed offer expiry refunds
  the reservation; a consumed lost lease releases physical capacity but retains
  budget as `usage_unknown` until a trusted usage receipt reconciles it.
- `paused`/`reclaim_checkpointable` stop new admission. They do not mark a Task
  cancelled. Portfolio can request checkpoint/release, never perform Task
  preemption itself.
- Requests and decisions are idempotent/replayable. Production storage must add
  Journal CAS and an outbox for grant/reclaim delivery; no process-local queue or
  timer may become authoritative.

## Production cautions

- Resource Pool price/rate catalogs and Sponsor policy revisions must come from
  trusted generation-owned resources. Message metadata cannot self-declare a
  priority override, budget transfer, or Project ownership.
- Usage receipts must be provider/executor-authenticated. An actual cost above
  reservation is still recorded and puts the account over budget; it is never
  clipped to make admission look valid.
- Long-running leases need heartbeat renewal with a maximum service quantum.
  Once a starvation/reclaim reservation exists, renewal must fail closed so a
  cooperative Project cannot monopolize a shared pool forever.
- Cumulative weighted service should be periodically normalized by an explicit
  Journal event to avoid unbounded counters without changing ordering.
- A Sponsor Room is a projection and command surface over Portfolio facts. It is
  not the Portfolio Journal writer and cannot replace Workroom control ports.
