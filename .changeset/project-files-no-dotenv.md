---
"@zhin.js/host-http": patch
---

Console project files no longer list, read or write `.env` / `.env.*` files (any spelling: letter case, `./`, `..`, URL encoding, trailing slash or space, symbolic links); such requests fail with an error pointing to the environment variables page (`/ops/env`). The file tree now includes the Agent bootstrap files (`SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`, alongside `AGENTS.md`) and the `knowledge/` directory (#1250).
