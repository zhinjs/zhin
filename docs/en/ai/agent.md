---
title: Agent Deep Dive
---

# Agent Deep Dive

Someone sends `ai: check tomorrow's weather` in a group, and a few seconds later the bot replies with a data-backed answer -- what happened in between? This page follows that path to expand on the [AI overview](./index.md) runtime: ZhinAgent's turn flow, deferred tools, sub-agents and orchestration, session persistence and compaction, Assistant profile and scheduled tasks.

## ZhinAgent turn

After a trigger match, Agent Host calls `zhinAgent.process(text, commMessage, tools)` to run a turn:

```mermaid
sequenceDiagram
    participant U as User (IM)
    participant H as Agent Host
    participant Z as ZhinAgent
    participant L as LLM (provider)
    U->>H: ai: check tomorrow's weather
    H->>H: Collect tools (plugin tools + MCP + built-in + deferred meta)
    H->>Z: process(text, commMessage, tools)
    Z->>L: agentLoop: system prompt + session history + tool catalog
    L-->>Z: tool_call(bash / web_search / spawn_task ...)
    Z->>Z: Security policy check → execute tool → write back result
    Z->>L: Continue (until no tool_call or maxIterations reached)
    L-->>Z: Final text
    Z-->>H: OutputElement[]
    H-->>U: IM reply (written to im_transcripts)
```

A few facts worth remembering. ZhinAgent, sub-agents, background workers, and `AIService.runAgent` all go through the **same agentLoop**, so behavior can be consistently expected. Messages in the same session queue up per `ai.agent.inboundQueue` (`groupMode: supersede | fifo`), and concurrent turns do not overwrite each other. When the preferred model fails, it falls back along a candidate chain to other available models from the same provider. `maxIterations` defaults to 15 (`DEFAULT_CONFIG.maxIterations`) and can be overridden per provider/model via the model harness (see below). Timeouts have three layers: the trigger-side single turn is bounded by `ai.trigger.timeout` (default 60000ms), the overall Agent turn defaults to 120000ms (`DEFAULT_CONFIG.timeout`), and tool pre-execution has a separate 15000ms cap (`preExecTimeout`).

The tool pool for a turn = plugin-registered tools + `ai.mcpServers` connected tools + built-in tools + deferred meta tools + `schedule_*` + `bash` + Host extension tools (e.g. `voice_stt` / `voice_tts`).

## Deferred tools (discover / load_tool / load_skill)

When the number of tools is large, stuffing all schemas into the prompt crowds the context. Zhin.js uses **lazy loading**: a turn keeps only a small set of meta-tools resident, and the model retrieves and loads by name on demand.

Resident tools (default `alwaysLoadedTools`): `ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`.

| Meta-tool | Purpose |
|-----------|---------|
| `discover` | Search for tools/skills by query (`kind: tool|skill|all`, filterable by MCP server); returns Top-K summaries |
| `load_tool` | Load a tool schema into the current session by name; callable thereafter |
| `load_skill` | Load a skill's description text and its declared tools |

Tuning (`ai.agent.deferredTools`):

```yaml
ai:
  agent:
    deferredTools:
      maxLoadedPerSession: 12   # Max tools loaded per session (default 12)
      discoverTopK: 5           # Number of discover results (default 5)
      alwaysLoadedTools: [ask_user, spawn_task, discover, load_tool, load_skill]
      mcpServers:
        icqq: { alwaysLoaded: [send_msg] }   # Resident tools for a specific MCP server
```

Reserved/built-in tool names (`bash`, `read_file`, `spawn_task`, etc.) cannot be overridden by plugins. For non-reserved tools, later registrations override earlier ones with the same name, and conflicts are logged as warnings.

## Sub-agents and spawn_task

The main Agent uses `spawn_task` to delegate complex/time-consuming tasks to **background sub-agents** without blocking the main conversation:

```yaml
ai:
  agent:
    maxParallelSubagents: 5        # Hard cap on parallel sub-agents (default 5)
    toolExecution: tiered          # parallel | sequential | tiered (default)
    subagentAutoContinue: true     # Wake main Agent to continue after async completion (default true)
    subagentDirectImDelivery: false # Also send sub-task summary directly to IM (default false)
    subagentTools: []              # Additional tools allowlisted for sub-agents
```

Key `spawn_task` parameters:

| Parameter | Description |
|-----------|-------------|
| `task` | Task description (goal, scope, expected output) |
| `agent` | Sub-agent name (must exist in `ai.agents` or `agents/*.agent.md` presets) |
| `wait` | When `true`, waits synchronously; result returns to the current turn via tool result |
| `context` | `fork` (inject recent messages from parent session) / `fresh` (empty context) |
| `tools` / `skills` | Declare tools and skills needed for the sub-task |

Several behavioral constraints apply: multiple `spawn_task` calls can be initiated in a single turn -- independent sub-tasks should run in parallel. In `tiered` mode, read-only tools and spawns run in parallel while write/bash operations execute sequentially. Sub-agents use a restricted tool set by default (`read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `web_search` / `web_fetch` / `bash` + deferred meta) and do not automatically inherit all tools from the main session; use `ai.agent.subagentTools` to explicitly add more. The sub-agent types visible to the main Agent are constrained by `ai.agents.<name>.permission.task` (glob -> allow/deny). After async completion, results are **returned to the main Agent first** (written to the main session and auto-continued); the user-visible reply is composed and sent by the main Agent. Additionally, sub-agent presets can be declared as files using `agents/<name>.agent.md` (YAML frontmatter + description), auto-discovered and registered at startup.

## Orchestration

`OrchestrationService` (Kernel) maintains a **Run / Task** state machine: a single user request can be split into multiple tasks with dependency relationships (`dependsOn`), dispatched for execution by executor (local / remote). Built-in orchestration tools:

| Tool | Purpose |
|------|---------|
| `orchestration_start` | Start an orchestration Run |
| `orchestration_add_task` | Add a task to a Run (role / goal / dependsOn / priority) |
| `orchestration_status` | Query Run / Task status |
| `orchestration_complete` | End a Run |
| `orchestration_retry_task` / `orchestration_skip_task` | Retry / skip failed tasks |

Run states: `open` -> `running` / `waiting` -> completed. After configuring `ai.remoteAgents` (`id` + `cardUrl` + `token`), tasks can be dispatched to remote A2A agents for execution:

```yaml
ai:
  remoteAgents:
    - id: local
      cardUrl: http://127.0.0.1:8069/a2a/zhin/.well-known/agent-card.json
      token: ${HTTP_TOKEN}
```

Orchestration runs can be viewed on the Console's Orchestration page (`GET /api/agent/orchestration/runs`); see [Console](../console/index.md).

## Session persistence and session tree

When a database is available, Agent Host persists three tables (automatically falls back to in-memory mode without a database):

| Table | Contents |
|-------|----------|
| `agent_sessions` | Agent session metadata (including session tree `parent_id` / `active_leaf`) |
| `agent_messages` | Agent turn messages (context store) |
| `im_transcripts` | IM inbound/outbound ledger (data source for the `chat_history` tool) |

Set `ai.sessions.useDatabase: false` to force in-memory mode.

Within the same IM conversation, sessions can also be branched into a session tree, managed via IM commands:

| Command | Purpose |
|---------|---------|
| `/compact` | Manually compact the current session context |
| `/tree` / `/tree N` | View / switch session branches |
| `/reset` | Reset the session |
| Send `clear` / `reset` | Archive and clear the current session's AI multi-turn context |

Other management commands (master / authorized users): `/models`, `/health`, `/cmd`, `/endpoints`, `/bindings`, `/tools`, `/mcp`.

## Compaction

Context is automatically compressed when approaching the window limit. Configure with `ai.agent.compaction`:

```yaml
ai:
  agent:
    compaction:
      enabled: true
      auto: true
      keepRecentTokens: 20000   # Token budget for keeping recent messages (default 20000)
      minKeepCount: 2           # Minimum number of messages to keep (default 2)
```

Compression triggers when estimated tokens exceed `contextWindow x 0.6`. Compression has two stages: first a micro-compact (trimming redundant tool results, etc.), then the LLM generates a `[Previous conversation summary]` to replace old history. If consecutive auto-compressions fail up to the limit, auto-compaction stops to avoid repeated consumption.

## Model harness

Override execution loop parameters per provider / model (currently consuming `maxIterations`). Merge order: TS default table -> `providerPatterns` (supports `*` wildcards) -> `models` exact keys:

```yaml
ai:
  agent:
    modelHarness:
      providerPatterns:
        "open*": { maxIterations: 7 }
      models:
        "gpt-4o": { maxIterations: 8 }
        "openai:gpt-4o": { maxIterations: 9 }
```

## Built-in tools

| Category | Tools |
|----------|-------|
| Execution | `bash`, `run_deferred_task` |
| File | `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep` |
| Network | `web_search`, `web_fetch` |
| Interaction | `ask_user` |
| Task | `spawn_task`, `todo_read`, `todo_write`, `orchestration_*` |
| Memory/Retrieval | `memory_search`, `memory_upsert`, `knowledge_search`, `chat_history` |
| Media | `generate_image`, `analyze_media` |
| Meta | `discover`, `load_tool`, `load_skill`, `install_skill` |
| Scheduling | `schedule_list`, `schedule_add`, `schedule_remove`, `schedule_pause`, `schedule_resume`, `schedule_preview` |

File tools run only inside the project workspace explicitly authorized for the current Turn. Relative paths resolve from that workspace; absolute paths must still remain inside it; `~`, directory traversal, and symlinks targeting paths outside the workspace fail closed in the shared policy facade. Only the canonical path approved by policy reaches the ToolFeature executor, and `glob` / `grep` do not spawn shell processes.

Network tools receive HTTPS authority only with `ai.agent.execPreset: network`. `web_fetch` revalidates protocol, domain, and SSRF policy for the initial URL and every redirect target. DNS results in private, link-local, CGNAT, or multicast ranges are denied, and the actual connection is pinned to the reviewed address. Other presets, including `readonly`, do not implicitly enable network access.

## Assistant profile and scheduled tasks

The Assistant runtime productizes "doing things on a schedule": persistent tasks are stored in `data/schedule-jobs.json` and executed by `ScheduleJobEngine` at the designated time, with results pushed back to IM.

```yaml
assistant:
  enabled: true
  profile:
    enabled: true
    file: assistant.profile.yml   # Relative to project root, this is the default name
  events:
    enabled: true                 # Enable POST /api/assistant/events external event endpoint
  defaults:
    notifyOnFailure: false
```

`assistant.profile.yml` declares the persona and routines, which are synced to scheduled tasks at startup:

```yaml
version: 1
persona:
  soul: You are a thoughtful life assistant.
routines:
  heartbeat:
    enabled: true
    everyMs: 1800000
    prompt: Check to-dos and report.
  morningBrief:
    enabled: true
    scheduleKind: solar      # solar | lunar | workday | freeDay | holiday
    cron: "0 0 8 * * *"
    tz: Asia/Shanghai
    prompt: Generate today's morning briefing.
```

Built-in routines include `heartbeat` (interval execution), `morningBrief` (default 08:00), `bedtimeCheck` (default 22:00), and `weatherReport`; custom keys are also supported. Note that for mainland China "workday" scenarios, use `workday` (which accounts for make-up workdays) instead of solar's `1-5`.

Users can also manage tasks directly in IM by having the Agent use `schedule_add` / `schedule_list` / `schedule_preview` and other tools. External systems can inject events via `POST /api/assistant/events` and query tasks via `GET /api/assistant/jobs`.

## Related

- [AI Capabilities Overview](./index.md): Installation, providers, triggers & security
- [Voice capabilities](./speech.md): STT/TTS for voice messages
