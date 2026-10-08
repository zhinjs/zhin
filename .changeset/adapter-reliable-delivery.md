---
"@zhin.js/adapter": patch
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"@zhin.js/cli": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-icqq": patch
---

Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.
