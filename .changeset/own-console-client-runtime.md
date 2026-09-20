---
"@zhin.js/client": patch
"@zhin.js/contract": patch
---

Replace the process-wide Console application, runtime environment, and WebSocket singleton with an explicitly created `ConsoleClient` that owns its application registry and REST/SSE transport. React transport hooks now resolve that owner through `ConsoleClientProvider`, and the obsolete `addPage` compatibility alias is removed from the plugin registration contract.
