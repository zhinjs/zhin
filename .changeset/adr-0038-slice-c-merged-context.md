---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0038 slice C: a merged group turn now tells the model who it is answering. The turn context carries a `[Merged turn]` list (sender id, name, message ids, text) and asks for one reply that @-mentions each sender it answers and skips nobody by pretending; the outbound audit records how many senders were merged and how many the reply answered.
