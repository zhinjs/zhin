---
"@zhin.js/cli": patch
"@zhin.js/agent": patch
---

Stop Workroom feedback loops in shared IM rooms by consuming trusted Bot principals without confusing Endpoint aliases with platform user IDs. Admit explicit mentions on member Bot endpoints, route projection replies through each member's configured or default primary endpoint, and keep governed `/work` requests inside Workroom when planning is unavailable. Converge stale Workroom projection bindings to the interaction binding revision with monotonic idempotent replay, and preserve Sponsor bindings when one Agent definition occupies multiple member roles.
