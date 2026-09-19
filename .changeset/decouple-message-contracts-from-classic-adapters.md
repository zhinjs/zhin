---
'@zhin.js/core': minor
'zhin.js': minor
---

Decouple canonical Message, Side Event, and middleware contracts from the classic Adapter class registry. Adapter identity now follows the Plugin Runtime string contract, and the unused `RegisteredAdapters`, adapter-message inference, and classic Endpoint config aliases are removed.
