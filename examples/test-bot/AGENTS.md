# Agent Instructions

## Reminders

Use `cron_add` for scheduled reminders — do NOT just write to memory.

## Heartbeat

If enabled, `HEARTBEAT.md` is checked periodically. Manage task lists via `edit_file` / `write_file`.

---

# Agent Memory

## User Preferences

- Language: 简体中文
- Style: concise, action-first
- Tech stack: TypeScript, Node.js, pnpm

## Completed

- Session compaction, hooks, bootstrap files
- Structured system prompt (11 segments)
- Skill-tool association
- Subagent (spawn_task) support
- MCP Client: `ai.mcpServers` + lazy connect on AI turn (see `ACCEPTANCE.md`)

## TODO

- [ ] Complete P0 items in [ACCEPTANCE.md](./ACCEPTANCE.md)
- [ ] Performance benchmarks
- [ ] Collect user feedback
