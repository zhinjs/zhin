---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/game-kit": patch
"@zhin.js/a2a": patch
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-lottery": patch
---

Harden Plugin Runtime migration boundaries: make process-level registries, the game
catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
active generation, discover workspace agents without mutating `process.cwd()`, and
require authentication for production A2A endpoints.

Game SessionServices and Group Suite mutable state now live in owner-scoped
resources. Lottery database, Agent dependencies, and outbound push bindings use
generation registrations with rollback-safe disposal.

The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
file, environment, and database RPCs, closing both direct and file-manager paths
that could expose `.env` values.
