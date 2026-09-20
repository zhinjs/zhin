---
"@zhin.js/agent": minor
---

Require every Workroom Projection binding and outbox item to carry an explicit audience and binding-generation cursor. Remove online normalization of legacy bindings and cursor migration, and split Projection contracts, repositories, state transitions, tracing, projection rules, and delivery into one canonical domain module.
