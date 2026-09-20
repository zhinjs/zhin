---
"@zhin.js/cli": patch
"@zhin.js/client": patch
"@zhin.js/config-file": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
---

Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
