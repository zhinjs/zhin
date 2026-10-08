---
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
---

Validate persisted Workroom Endpoint bindings against the exact projected candidate generation, including adapters authored by the project root. Defer file-backed Endpoint validation until candidate activation. Resolve Console Endpoint package aliases consistently with discovery and reject ambiguous aliases instead of selecting an account.

Resolve Workroom human ingress from the canonical Endpoint capability identity and the operation Endpoint projection so root-local adapters use the same Catalog address as Console discovery. Unknown or duplicate canonical identities cannot select another account.
