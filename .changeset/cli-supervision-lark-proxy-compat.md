---
"@zhin.js/cli": patch
"@zhin.js/adapter-lark": patch
---

Keep native TypeScript process supervision at the CLI entry point so programmatic runtime startup does not respawn its caller. Pair the Lark proxy dispatcher with its Undici fetch implementation to support newer Node versions while retaining TLS verification and delivery uncertainty handling.
