# @zhin.js/harness

ADR 0048 Agent Harness (H1, internal, unpublished): actors exchange **mail** inside an **engagement**; every mail carries an **authority** that can only be attenuated and a **budget grant** carved from its parent; a **guard kernel** decides delivery; an **engagement journal** records everything.

See `docs/adr/0048-agent-harness.md`. The shared contracts live in `src/contracts.ts`; each component (authority, budget, guard, journal, mailbox) depends only on them.
