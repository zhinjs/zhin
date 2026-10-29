---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0041 slice A: participant headers. The trusted host stores the full `[id:…;user_id:…;name:…;role:…;group_nickname:…;group_title:…;mute_time:…;time:…;]` header in `UserMessage.name` / `AssistantMessage.name` (built from the conversation actor and the turn's bot facts, never from model output). At the LLM boundary `projectPromptContext` now sends the full header on a `user_id`'s first appearance in the visible window, the short `[id;user_id;time]` form afterwards, and synthesizes a `member_changed` event before a message whose sender facts changed without a recorded event; the header is the first line of the text and stored history is never mutated. Replaces the `[User]{…}` JSON and `[sender:…]` labels (`buildActorPrefix` is removed); `normalizeUserMessageForStorage` strips the new header line. Legacy messages without `name` derive the header from `actor`.
