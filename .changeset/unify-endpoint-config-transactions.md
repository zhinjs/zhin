---
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/cli": patch
"@zhin.js/config-file": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
---

Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
