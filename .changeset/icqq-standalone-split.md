---
"@zhin.js/adapter-icqq": patch
---

Messages mixing text with standalone ICQQ elements (share, file, voice, video, JSON card, forward) are now sent as ordered separate messages instead of failing with "must be sent as a standalone message". A failure after the first part is reported as `partial_delivery` with an unknown outcome so it is never resent.
