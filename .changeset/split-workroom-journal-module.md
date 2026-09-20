---
"@zhin.js/agent": patch
---

Split the Workroom Journal into a canonical domain module with explicit contracts, Memory/File/Database adapters, event validation and codec, stored control projection, and governed payload publication/replay boundaries. Preserve the package-root API while removing the monolithic source entry and migrating all internal consumers to the new module.
