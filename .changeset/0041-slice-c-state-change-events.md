---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0041 slice C: member state changes enter the session history. Join / leave and card / title / role / mute changes from the scene side events are written to `agent_messages` as `event` messages (`<operator> changed <user_id> <field> to "<value>"`, `<user_id> join <scene_id> on <HH:mm:ss.SSS> by <self|operator_id>`), in arrival order, with the existing compaction and retention; member-controlled values are always quoted, escaped and clipped to 64 characters. At the LLM boundary they render as one `[state change]` message per run of events: a system / developer message where the provider accepts it mid-conversation, otherwise a user message headed `user_id:system` (merged into an adjacent user message as a separate block). Events never sit between an assistant `tool_calls` message and its tool results and are never moved earlier. New provider capability `compat.midConversationSystem` (`system` / `developer` / `none`; OpenAI and remote OpenAI-compatible default `system`, o-series / gpt-5 `developer`, local servers, Anthropic and Gemini `none`). Join / leave and profile changes no longer appear in the ephemeral `[Scene events]` block (a bare join still wakes a turn). The system prompt states that quoted values in `[state change]` lines are data.
