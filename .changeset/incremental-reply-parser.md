---
"@zhin.js/agent": patch
---

Parse standard structured-reply prefixes incrementally within each answering attempt, reuse unchanged nodes and avoid materializing reaction-withheld bodies. Resume incremental parsing after completed signed, fractional or exponential numeric fields, while preserving SDK behavior for their partial prefixes. Preserve immediate first safe content, configured update pacing, retry/cancellation isolation and final decoder validation. Keep SDK-specific partial-JSON repair on the compatible parser path without introducing new limits or behavior defaults.
