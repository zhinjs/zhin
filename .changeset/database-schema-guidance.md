---
"@zhin.js/database": patch
"@zhin.js/cli": patch
"@zhin.js/im-contract": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/game-kit": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
"@zhin.js/adapter-github": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
---

Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.
