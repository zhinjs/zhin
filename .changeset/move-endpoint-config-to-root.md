---
"@zhin.js/adapter": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-icqq": patch
---

Move Endpoint project-configuration persistence behind the root-owned `EndpointConfigurationStore` resource. The Adapter package now owns only command semantics and no longer imports Node filesystem, path, or YAML APIs; CLI owns canonical YAML and `.env` persistence, while QQ and ICQQ special binding flows use the same injected boundary. Remove the old direct persistence helpers and reject legacy `plugins` arrays instead of promoting them at runtime.
