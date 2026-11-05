---
"@zhin.js/cli": patch
---

Recognize adapter encryption keys and app/verification tokens in the shared configuration sensitivity check. Mask these fields in default project reads and conflict evidence, and reject chat reads and writes. Explicit administrator reveal and ordinary token-budget fields retain their existing behavior.
