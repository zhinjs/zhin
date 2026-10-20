---
"@zhin.js/plugin-bilibili": patch
---

Add `@zhin.js/plugin-bilibili`: per-conversation Bilibili live-start and UP dynamic subscriptions (`bili sub|unsub|list|live`), a conservative scheduled watcher with jitter, exponential backoff, baseline-first dedupe and WBI signing, database persistence with an in-memory fallback, and read-only agent tools `bili_live_status` / `bili_list_subscriptions`. In groups and channels `bili sub` / `bili unsub` are limited to the group owner, admins and the bot master; private chats can manage their own subscriptions.
