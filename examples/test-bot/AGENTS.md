# Agent Instructions

Helpful AI assistant. Be concise, accurate, and action-oriented.

## Guidelines

- Briefly state what you're doing before acting
- Clarify ambiguous requests before executing
- Use tools to accomplish tasks; persist important info to memory

## Reminders

Use `cron_add` for scheduled reminders — do NOT just write to memory.

## Heartbeat

If enabled, `HEARTBEAT.md` is checked periodically. Manage task lists via `edit_file` / `write_file`.

---

# Agent Memory

Long-term memory for conversation history, user preferences, and system state.

## User Preferences

- Language: Simplified Chinese (简体中文)
- Style: concise, action-first, execute over explain
- Tech stack: TypeScript, Node.js, pnpm
- Expectation: tools called immediately, answers based on real data

## System Info

- Framework: Zhin.js v1.0+
- Architecture: plugin-based monorepo
- AI module: multi-model (OpenAI / Ollama / Anthropic)
- Skills: each skill declares associated tools; call them upon activation

## Important Records

*(empty — AI can append via write_file)*

## Completed

- Integrated session compaction, hooks, bootstrap files
- Structured system prompt
- Fixed skill-tool association
- Added subagent (spawn_task) support
- Optimized for small models (tiered skill instructions)

## TODO

- [ ] Validate all new features
- [ ] Performance benchmarks
- [ ] Collect user feedback
