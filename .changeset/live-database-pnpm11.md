---
"@zhin.js/database": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

Fix MySQL, PostgreSQL, MongoDB, and Redis behavior found by live database integration tests, including deterministic table initialization on single database connections. Generate endpoint IDs consistently, emit pnpm 11 workspace build permissions from new projects, and report the selected AI session database accurately during initialization.
