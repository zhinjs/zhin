---
"@zhin.js/core": patch
---

Keep the bot's own messages in conversation context, labeled `You (this bot)`, instead of dropping them. Without them the Agent could not tell its own words from the members', missed what it sent outside its reply (command replies, music cards, scheduled notices) and lost the order of the chat. Progress updates (`⏳`), messages the bot later recalled (activity indicators) and interaction prompts with their answers stay out. An inbound message without a sender is now recorded as `Unknown sender` so it is never mistaken for the bot's own.
