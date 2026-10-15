---
"@zhin.js/agent": patch
---

Eval mock tools can declare `parameters` (JSON Schema), which is sent to the model. Cases with live checks must declare every argument their script passes. This fixes the nightly `seed-group-member-read-only-lookup` failure, where a real model saw `get_weather` with no arguments and called it without a city.
