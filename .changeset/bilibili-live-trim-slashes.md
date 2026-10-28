---
'@zhin.js/adapter-bilibili-live': patch
---

Trim trailing slashes from `apiBaseUrl` / `liveApiBaseUrl` with a linear scan instead of a regex that could backtrack polynomially on long runs of `/` (CodeQL js/polynomial-redos).
