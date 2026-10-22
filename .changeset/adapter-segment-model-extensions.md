---
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-icqq": patch
---

Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
