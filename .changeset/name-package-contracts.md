---
"@zhin.js/runtime": patch
---

Rename the misleading Runtime `compatibility` module to `package-contract` and replace `PackageCompatibilityError` with `PackageContractError`. Engine and Feature API semver checks are current manifest invariants, not a legacy compatibility layer; no deprecated alias is retained.
