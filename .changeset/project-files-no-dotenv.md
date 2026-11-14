---
"@zhin.js/host-http": minor
---

Console project files no longer list, read or write `.env` / `.env.*` files (any spelling: letter case, `./`, `..`, URL encoding, trailing slash or space, symbolic links); such requests fail with an error pointing to the environment variables page (`/ops/env`). Other dot files and dot directories (`knowledge/.envrc`, `.npmrc`, `.ssh/`, …) are refused at any depth as well. The file tree now includes the Agent bootstrap files (`SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`, alongside `AGENTS.md`) and the `knowledge/` directory (#1250).

**Breaking for older Consoles:** an older Console that edits `.env` through project files (`files:read` / `files:save` of `.env`) is now refused — upgrade the Console and use the environment variables page.
