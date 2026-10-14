---
'@zhin.js/agent': patch
---

Stream observers of `executeAgentTurn` now read a journal-derived feed: the turn journal is the single source, so authority tool events (`tool_call` / `tool_result` / `tool_denied`) committed by TurnToolRuntime reach stream consumers in commit order with the existing TurnEvent shape, without being journaled twice. Adds `createJournalFeed` / `journalFeedOf`.
