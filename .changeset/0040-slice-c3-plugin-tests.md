---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

ADR 0040 slice C3: the self-change trial runs the drafted plugin's own tests in an isolated, offline container (read-only dependencies, writable throwaway copy) after the sandbox load; skipped without Docker, without tests, or when the tests fail even without the draft.
