---
"@zhin.js/adapter": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/adapter-qq": minor
"@zhin.js/cli": minor
"@zhin.js/config-file": minor
"@zhin.js/plugin-runtime": minor
"@zhin.js/runtime": minor
---

Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
