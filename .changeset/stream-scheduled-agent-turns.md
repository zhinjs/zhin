---
'@zhin.js/agent': patch
---

Schedule the canonical Agent `TurnEvent` stream through `PromptController` and
persist synthesized failure, cancellation, and missing-terminal facts before
returning a `TurnOutcome`.
