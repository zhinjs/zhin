---
'@zhin.js/agent': patch
---

Replace Message-based inbound media resolution with canonical `TurnMedia` processing. IM segment fallback and platform references are projected only by the ingress adapter before media materialization, transcription, and model injection.
