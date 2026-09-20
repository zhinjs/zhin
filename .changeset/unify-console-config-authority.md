---
"@zhin.js/cli": minor
"@zhin.js/client": minor
"@zhin.js/config-file": minor
"@zhin.js/console-protocol": minor
"@zhin.js/host-http": minor
---

Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
