---
"@zhin.js/adapter": minor
"@zhin.js/cli": minor
"@zhin.js/adapter-qq": minor
"@zhin.js/adapter-icqq": minor
---

Move Endpoint project-configuration persistence behind the root-owned `EndpointConfigurationStore` resource. The Adapter package now owns only command semantics and no longer imports Node filesystem, path, or YAML APIs; CLI owns canonical YAML and `.env` persistence, while QQ and ICQQ special binding flows use the same injected boundary. Remove the old direct persistence helpers and reject legacy `plugins` arrays instead of promoting them at runtime.
