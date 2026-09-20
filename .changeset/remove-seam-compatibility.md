---
'@zhin.js/agent': patch
---

Remove the unused legacy Capability Seam DI symbol and direct Tool and Skill invocation compatibility APIs. Capability Seam now enters the runtime only through the generation-owned `capabilitySeamToken`, provider projection, and the canonical Turn Tool Runtime.
