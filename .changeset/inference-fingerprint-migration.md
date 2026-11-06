---
"@zhin.js/cli": patch
---

Migrate stored API-key material fingerprints from the legacy sha256 form to the scrypt form introduced in 1.1.29 before authorization compares them, so an unchanged API key (including `env://` keys) is no longer treated as an identity change and locked in `reauthorize`. Rows already locked by the algorithm change are restored when the current environment key is exactly the one fingerprinted; real key rotations stay locked.
