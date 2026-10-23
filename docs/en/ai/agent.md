---
title: "Agent Deep Dive"
description: "How an AI turn runs: progress and cancellation, on-demand tools, sub-agents, sessions and context compaction, built-in tools, schedules, per-model tuning, and multi-agent Workrooms"
---

# Agent deep dive

Someone sends `ai: what's the weather tomorrow` in a group and a few seconds later the bot answers with real data — what happened in between? This page follows that path through the runtime that the [AI overview](./index.md) doesn't cover in detail.

Haven't enabled AI yet? Start with the [AI overview](./index.md). Want the AI to call your functions? See [Agent tools and Skills](../authoring/agent-tools.md).


### Per-turn usage logs

At the default INFO level, every executed Agent turn ends with one `[ai.usage] turn` summary, including failed and cancelled turns. No manual `zhin trace` query is required. Fields have a fixed order; these usage logs contain no chat text, reasoning text, prompts, tool arguments or tool results.

```text
[INFO] [ai.usage] turn | trace: trace-1 | turn: turn-1 | scene: qq/group | status: completed | model: main/model | calls: 2 | input: 4200 | output: 180 | cache_read: 3000 | cache_write: 0 | reasoning: ? | ms: 1850
```

- `input`, `output`, `cache_read`, `cache_write` and `reasoning` are tokens from SDK-normalized provider usage. Cache reads/writes are parts of input and reasoning is part of output; do not add them again. Character estimates never replace reported usage.
- `?` means unavailable. `0` means an explicit zero or no recorded model responses. `>=60` means some calls omitted the field and the known calls sum to 60. Unproven legacy zero values also display as `?`.
- `calls` counts responses observed by the turn, including summaries, progress reports, reply repair and synchronous child turns on the shared completion path. `subagent_calls` is a subset, not an extra amount. SDK-internal HTTP retries have no separate response event and are not counted as separate requests.
- Summaries include child traces recorded so far; `partial` flags unsuccessful turns, incomplete child completion or bounded records being dropped; displayed usage is the recorded part, not a complete total. This is not account-wide billing: independent decisions, embeddings and image generation outside this trace are excluded, and failed requests without usage cannot be estimated.
- `ms` is trace turn duration. Use `trace` to correlate logs and `turn` with `zhin trace <turn>` to inspect an existing archive. Logs work without archiving; enabling logs does not add persistence.

Set Root `log_level` to `debug` for `[ai.usage] call` records with each observed response's model, stop reason, usage and known duration. `[ai.usage] context` prints the existing first-request budget as `unit: estimated_tokens`, not actual per-call billing. Restore `info` for summaries only. `warn`, `error` and `silent` suppress these INFO/DEBUG records. Other modules retain their existing DEBUG behavior.

```yaml
log_level: debug
```


SQL databases persist structured usage independently, with a default 30-day retention. See [structured storage and usage queries](../operations/structured-storage.md).

## Find by question

| I want to know… | See |
| --- | --- |
| How a turn runs, how many iterations, when it times out | [How a turn runs](#how-a-turn-runs) |
| Show "thinking" progress, or cancel midway | [Showing progress](#showing-progress) · [Cancelling a running turn](#cancelling-a-running-turn) |
| How lots of tools fit without flooding the prompt | [On-demand tools](#on-demand-tools) |
| Hand long tasks to the background | [Sub-agents and spawn_task](#sub-agents-and-spawn-task) |
| Where history is stored, how to reset, what happens when context gets long | [Sessions and session trees](#sessions-and-session-trees) · [Context compaction](#context-compaction) |
| What the AI remembers, and who can change it | [Semantic memory](#semantic-memory) |
| Which tools the AI has built in, and file / network boundaries | [Built-in tools](#built-in-tools) |
| Have the AI do things on a schedule | [Schedules and the assistant persona](#schedules-and-the-assistant-persona) |
| Tune parameters for one model | [Per-model tuning](#per-model-tuning) |
| Several Agents dividing work in a group or repository | [Workroom Kernel](#workroom-kernel) |

## How a turn runs

Once a message meets the trigger rules, the Agent Host calls `zhinAgent.process(text, commMessage, tools)` to run one **turn**:

```mermaid
sequenceDiagram
    participant U as User (IM)
    participant H as Agent Host
    participant Z as ZhinAgent
    participant L as LLM (provider)
    U->>H: ai: what's the weather tomorrow
    H->>H: Collect tools (plugin + MCP + built-in + deferred meta)
    H->>Z: process(text, commMessage, tools)
    Z->>L: agentLoop: system prompt + session history + tool catalog
    L-->>Z: tool_call(bash / web_search / spawn_task …)
    Z->>Z: Security policy check → run tool → write back result
    Z->>L: Continue (until no tool_call or maxIterations)
    L-->>Z: Final text
    Z-->>H: OutputElement[]
    H-->>U: IM reply (ConversationEvent appended)
```

The model may call tools several times and keep reasoning on the results; each round is an **iteration**. Things to remember:

- **Iteration limit**: `maxIterations` defaults to 15 (`DEFAULT_CONFIG.maxIterations`) and can be tuned per model — see [Per-model tuning](#per-model-tuning).
- **Three layers of timeout**: one turn on the trigger side is limited by `ai.trigger.timeout` (default 60000ms); the whole Agent turn defaults to 120000ms (`DEFAULT_CONFIG.timeout`); tool pre-execution has its own 15000ms cap (`preExecTimeout`).
- **Messages that arrive while a turn is running**: one conversation runs one turn at a time, and later messages follow these defaults (`ai.agent.inboundQueue`) so there are no duplicate replies, no lost messages and no crossed turns:
  - **Same sender adds more**: if the running turn has not replied yet, it is stopped and both messages are answered together in a fresh turn (with `groupMode: fifo` the message queues instead). If it already replied, the message queues. If the sender already has a queued message, the new one merges into it instead of producing another reply.
  - **Anyone else**: always queued in arrival order. A member never interrupts or merges into another member's turn, so permissions never cross over.
  - **Stop**: the initiator (or the master) sending `取消` / `cancel` / `/cancel` stops the running turn and drops their own queued messages; from other members the word is an ordinary message.
  - **Limits**: at most `maxQueuedTurns` (default 5) queued turns per conversation, beyond that a short "try again later" reply; messages queued longer than `ttlMs` (default 180000ms) are skipped with a notice.
  - Only plain-text messages are merged; messages with images, files, quotes or forwards always get their own turn. Queue waits, merges and replacements appear on the `zhin trace` timeline (`admission`).
  - Workroom turns, and setups where the Host supplies `resolveTurnIntent` or a message carries `turnIntent`, keep their explicit intent semantics.
- **Automatic model fallback**: if the preferred model fails, the candidate chain falls back to other available models of the same provider.
- **Consistent behavior**: the main Agent, sub-agents, background workers and `AIService.runAgent` all use the same agentLoop.

The tools available to a turn = plugin tools + tools from `ai.mcpServers` + built-in tools + on-demand meta tools + `schedule_*` + `bash` + Host extension tools (such as `voice_stt` / `voice_tts`).

### Showing progress

While a turn runs, the Agent pushes status to the chat through [Activity feedback](../advanced/activity-feedback.md). By default that's a static "thinking…"; with **thinking transparency** enabled, users see fragments of the model's actual thinking:

```yaml
ai:
  agent:
    thinkingPreview: true          # show the LLM's actual thinking (truncated), default false
    thinkingPreviewMaxLength: 200  # max characters shown, default 200
```

When a turn needs several tool iterations, each starts with an `iteration_start` event and the status updates to progress like `Processing [2/15]...`. Plugins can listen to the `TurnEvent` stream for progress:

| TurnEvent type | Description |
|----------------|-------------|
| `iteration_start` | A new iteration begins, with `iteration` (current round) and `maxIterations` |
| `thinking` | An LLM thinking fragment (streamed continuously when `thinkingPreview` is on) |

### Cancelling a running turn

Users can send `取消`, `/cancel` or `cancel` in chat to stop the current turn: ZhinAgent aborts the model call and tool execution via `PromptController.cancelSession()` and replies "cancelled". With nothing running, it replies that there's no task in progress.

In the `TurnEvent` stream, a user cancel appears as `turn_cancelled` (`code: 'cancelled'`); a timeout appears as `turn_cancelled` too (`code: 'timeout'`).

## Turn usage

A completed text or IM Agent turn accumulates the provider-reported usage of all responses returned through its completion port: tool selection, the final answer, context compaction, progress and exhausted-turn summaries, and format correction. Responses rejected by reply validation still count. Transport failures that return no usage are not assigned an estimated billing usage. This total is not a provider invoice reconciliation. User and group quotas remain disabled by default.

## On-demand tools

With many tools, putting every tool's parameter schema in the prompt would fill the context. Zhin **loads tools lazily**: a turn keeps only a few meta tools resident, and the model searches and loads others by name when needed.

The resident core set (`alwaysLoadedTools`) has two groups:

- Interaction and orchestration: `ask_user`, `spawn_task`, and the meta tools `discover`, `load_tool`, `load_skill`.
- Workspace files: `read_file`, `list_dir`, `glob`, `grep`, `edit_file`, `write_file`. The model calls these directly most often, so keeping them resident saves an "unknown tool" round trip. They are still subject to the turn's tool filters and exec policy; for example, a turn started by a group member gets no file-writing tools.

`bash` is not resident because whether it can run depends on the turn's shell isolation policy. Setting `alwaysLoadedTools` **adds to** this default list; set `alwaysLoadedMode: replace` to replace it entirely.

Plugin tools are deferred by default. A plugin author can set `alwaysLoaded: true` in `defineAgentTool` to keep a few frequent tools resident (at most 8 per turn, ignored under `alwaysLoadedMode: replace`); see [Keep a tool resident](../authoring/agent-tools.md#keep-a-tool-resident). Resident schemas are sent on every turn, so the smaller the set, the less context and tokens it costs.

Other tools send no parameter schema. The system prompt lists them in a `## Deferred tools` section with their name and a description of at most 60 characters, up to 40 entries; beyond that it points the model at `discover`. The model can call `load_tool(name)` to get the schema, and calling the tool directly also loads it. The index only contains tools this turn may use: tools removed by policy (such as `bash` without shell access) never appear.

Skills use progressive disclosure: the system prompt lists each skill's name and the first line of its trigger description (at most 96 characters, up to 40 entries), and the specialist agent catalog works the same way. A skill's full instructions enter the context only after `load_skill`, or when intent matching activates it.

The context cost of each turn's first model request is estimated per segment and stored in the turn trace's `context_budget` field, which `zhin trace last` shows: system prompt, tool schemas, deferred tool index, skill catalog, specialist agent catalog, loaded skills, memory, bootstrap, history and the current input, plus the largest prompt sections. These are estimates (CJK ≈ 1 token per character, other text ≈ 4 characters per token); real usage is still in the model call records.

Built-in instructions retain essential rules while JSON Schema describes message fields. Adapters own platform-specific guidance and disclose only the Skills, Tools and segments applicable to the current scene. Shorter fixed instructions add no intent-classification request and do not change file tools, multi-agent, permission or approval configuration. Compare tool schemas, output schemas, history, request counts and cache usage as well: fewer prompt characters do not imply the same percentage reduction in whole-turn cost.

| Meta tool | Purpose |
|-----------|---------|
| `discover` | Search tools / skills by keyword (`kind: tool|skill|all`, optionally per MCP server), returning Top-K summaries |
| `load_tool` | Load a tool's definition into this session so it can be called |
| `load_skill` | Load a skill's full text and unlock the tools it declares |

Tuning (`ai.agent.deferredTools`):

```yaml
ai:
  agent:
    deferredTools:
      maxLoadedPerSession: 12   # max tools loaded per session (default 12)
      discoverTopK: 5           # results returned by discover (default 5)
      alwaysLoadedTools: [ask_user, spawn_task, discover, load_tool, load_skill]
      mcpServers:
        icqq: { alwaysLoaded: [send_msg] }   # resident tools for a specific MCP server
```

Reserved built-in names (`bash`, `read_file`, `spawn_task`…) can't be overridden by plugins; for non-reserved tools with the same name, the later registration wins and a warning is logged.

## Sub-agents and spawn_task

The main Agent can use `spawn_task` to hand complex or slow work to a **background sub-agent** without blocking the conversation.

```yaml
ai:
  agent:
    maxParallelSubagents: 5        # parallel sub-agent cap (default 5)
    toolExecution: tiered          # parallel | sequential | tiered (default)
    subagentAutoContinue: true     # wake the main Agent to continue when a sub-task finishes (default true)
    subagentDirectImDelivery: false # also post the sub-task summary straight to chat (default false)
    subagentTools: []              # extra tools for sub-agents
```

Main `spawn_task` parameters:

| Parameter | Description |
|-----------|-------------|
| `task` | Task description: goal, scope, expected output |
| `agent` | Sub-agent name (must exist in `ai.agents` or `agents/<name>/agent.json`) |
| `wait` | `true` waits synchronously; the result returns as the tool result in this turn |
| `context` | `fork` (include the parent session's recent messages) / `fresh` (empty context) |
| `tools` / `skills` | Tools and skills the sub-task needs |

- One turn can start several `spawn_task`s; independent sub-tasks should run in parallel. In `tiered` mode, read-only tools and spawns run in parallel while writes and `bash` run sequentially.
- Sub-agents get a restricted tool set by default: `read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `web_search` / `web_fetch` / `bash` plus the on-demand meta tools — not everything the main session has. Add more with `ai.agent.subagentTools`.
- Which sub-agents the main Agent may dispatch is controlled by `ai.agents.<name>.permission.task` (glob → allow / deny).
- When an async task finishes, the result goes **back to the main Agent first** (written into the main session and continued automatically), which then composes the reply to the user.
- Sub-agents are declared with `agents/<name>/agent.json` plus three core Markdown files and discovered at startup. See [Agent tools and Skills · Define a sub-agent](../authoring/agent-tools.md#define-a-sub-agent).

## Sessions and session trees

With a database available, conversations persist to these tables (in memory otherwise):

| Table | Contents |
|-------|----------|
| `agent_sessions` | Agent session metadata (including the session tree's `parent_id` / `active_leaf`) |
| `agent_messages` | Agent turn messages |
| `conversation_events` | Chat messages, quote relations and notices (idempotent append) |
| `conversation_event_cursors` | Unread event cursors per Agent session |

Set `ai.sessions.useDatabase: false` to force memory mode.

One chat conversation can also branch into a **session tree**, managed with chat commands:

| Command | Purpose |
|---------|---------|
| `/compact` | Compact the current session's context manually |
| `/tree` / `/tree N` | View / switch session branches |
| `/reset` | Reset the session |
| Send `clear` / `清空` / `重置` | Archive and clear this conversation's AI context |

Masters and permitted users also have `/models`, `/health`, `/cmd`, `/endpoints`, `/bindings`, `/tools` and `/mcp`.

## Context compaction

When a conversation nears the model's context window it's compacted automatically (`ai.agent.compaction`):

```yaml
ai:
  agent:
    compaction:
      enabled: true
      auto: true
      keepRecentTokens: 20000   # token budget for recent messages (default 20000)
      minKeepCount: 2           # minimum messages kept (default 2)
      thresholdRatio: 0.7       # share of the context window that triggers auto-compaction (default 0.7)
```

Compaction has two steps:

1. Above `contextWindow × 0.6` of messages, a light trim drops redundant tool results and the like.
2. When message tokens exceed the available message budget, the model writes a `[Previous conversation summary]` to replace older history. The budget deducts the system prompt, full input schemas of disclosed tools, and the structured output schema from `contextWindow × thresholdRatio`. For windows larger than 13k, it is also capped by the window minus the 13k buffer and fixed request cost, with a minimum budget of zero. This applies to plugin-runtime sessions such as QQ as well.

`keepRecentTokens` is the requested recent-history budget. Small windows or large fixed prompts reduce the effective budget to the smaller of the configured value and the available message budget divided by 1.25, rounded down. `minKeepCount` and tool call/result pairing still take precedence. If a single message or the latest tool exchange already exceeds the window, compaction cannot guarantee the request fits and does not force-delete recent messages. Only the model's context projection changes; persisted original messages remain available.

Estimates include tool arguments, text and thinking blocks. Media uses a rough per-block allowance, not the length of its base64 encoding. Actual costs depend on the provider, resolution, page count and duration; estimates are neither billing figures nor a safe upper bound.

The summary prompt asks the model to retain unfinished work, user preferences and **conclusions and commitments already given to the user**. A summary is accepted only when it finishes normally, contains text, and is smaller than the replaced history including its message wrapper. Truncated, failed, cancelled or tool-calling summaries are not persisted. Failure retains the context from before summarization (existing micro-compaction is not rolled back), without deleting additional history. After a limit of consecutive failed auto-compactions, auto-compaction stops to avoid repeated cost.

Summary checkpoints use the actual persisted prefix summarized in this run. If the prefix contains unpersisted messages, its provenance is unknown, or the branch or summary revision changed, only the current projection is compacted; no guessed checkpoint is saved. Custom `ContextRepository` implementations can implement the optional `saveCompactionSummary`; otherwise checkpoint persistence is skipped. Cancellation while waiting to write skips the save, but cannot undo a write already submitted to the database.

### "Already told" ledger

Each session remembers what was already sent to the user, up to 8 entries of at most 120 characters each:

- the lead sentence of each final reply is recorded as a conclusion;
- sentences that promise future action ("I'll…", "我会…", "稍后…") are recorded as commitments;
- each progress update (#718) is recorded as progress.

Progress updates and final replies share this one record, and a repeated statement keeps only its newest copy. The next turn gets it as a short `[Already told the user]` block inside `[Turn context]`, so the model neither repeats itself nor contradicts what it said, and compaction is told to keep these items in its summary. The ledger is visible only within its own session and lives in process memory; after a restart, the persisted history and its compaction summary carry the same facts.

### Prompt caching

Stable rules stay in the system prompt. Git status, time, session details and the current deferred-tool catalog belong to the current user context, so loading tools or changing files does not rewrite the system prefix. Tool definitions have a stable name order; current permissions and platform capabilities still determine the offered tools and schema.

Runtime-injected workspace rules and loaded skills carry provenance. The model sees the first full version and short references for identical repetitions; changes emit the full new version. Raw history retains every original body. Tail loads, branch switches and compaction recompute the first full version from the available history, so references cannot point outside it. Unmarked legacy records, user text and ordinary tool results are never deduplicated by guessing from their text. `load_tool` confirms loading; the following request's tool definition supplies the arguments.

Anthropic marks both the current input end and the input boundary before the latest assistant response, alongside system and tools: at most four runtime breakpoints. The prior boundary is reconstructed from current history so added content cannot push the previous write beyond the 20-block lookback window. These are transport-only markers; raw history is unchanged. `promptCache: false` still disables these markers. OpenAI keeps its existing routing key and automatic prefix caching; compatible gateways still require the declared capability for extra fields, and Gemini explicit caching keeps its existing configuration. TTLs and model-call counts are unchanged.

`zhin trace last` reports cache-hit tokens returned by the provider. Context estimates include the output schema and projected messages after deduplication. Prefix tests prove reuse eligibility, not a server-side cache hit: actual hits, costs and latency depend on the model, cache lifetime and returned usage.

## Semantic memory

With `ai.memory.semantic.enabled`, `memory_upsert` / `memory_search` store memory in the `memory_entries` database table. Each entry has:

| Field | Meaning |
| --- | --- |
| `scope` / `scope_key` | Visibility: `global`, `platform`, `session` (this conversation), `user` (the current initiator) |
| `kind` | `user_fact` (stable fact), `preference`, `task_state` (temporary, expires), `episodic` (something that happened) |
| `source` / `source_turn` / `trust_level` | Which turn wrote it and at which trust level. Filled in by the runtime; the model cannot set it |
| `confidence` | 0–1 |
| `created_at` / `updated_at` / `expires_at` / `last_used_at` | Created, updated, expiry, and last recalled times |
| `history` | Previous versions kept when content is replaced (up to 5, newest first) |

Write rules:

- A group member (`group_member`) can write only to their own `user` scope or the current `session`, never `global` / `platform`. Without a `scope` their writes default to `user`; owner and trusted members still default to `global`.
- An existing `user_fact` / `preference` cannot be overwritten from a lower trust level, so a group member cannot change what the owner recorded. Writes from the same or a higher level win, and the old value moves to `history`.
- `task_state` always expires: 24 hours by default, `ttl_hours` at most 168. Bind it to a task with `task_id`; when the host's `isTaskActive` (on `SemanticMemoryRuntime`) reports the task gone, the state is no longer recalled.
- File memory (`data/memory/**/MEMORY.md`) is unchanged and stays readable; `renderMemoryEntriesMarkdown()` exports structured memory as Markdown.

On upgrade, an existing `memory_entries` table gains the new columns at startup (`ALTER TABLE … ADD COLUMN`) and keeps its rows: old entries read as `user_fact` with an empty trust level, protected like a trusted member's.

### Retrieval and per-turn recall

`memory_search` and per-turn recall rank with BM25 (Latin text by word, CJK by single characters and bigrams; no segmenter needed). At the start of each turn the Agent searches the scopes the initiator can see (this session, their own `user` scope, the current platform, `global`) with the current message and adds the best matches to the turn context under `Relevant memory`, labelled as data, not instructions. How much is injected depends only on `topK` and `maxTokens`, not on how many entries exist. Expired, deleted, and other users' `user` entries are never recalled. Recalled or searched entries update `last_used_at`.

```yaml
ai:
  memory:
    semantic:
      enabled: true
      recall:
        enabled: true    # default true; false keeps only the memory_search tool
        topK: 5          # entries injected per turn, at most 20
        maxTokens: 400   # token budget for the recall block (estimated)
```

### Viewing and forgetting

- Any user can send `/memory` to see what is stored about them (their own `user` scope, up to 20 entries), `/forget <key or id>` to forget one entry, or `/forget all` to forget everything. They only touch the sender's own memory; without semantic memory enabled these commands are not intercepted.
- Hosts and the Console view, edit, and delete memory in any scope through `SemanticMemoryRuntime` `list` / `upsert` / `delete`.

Markdown file memory (`MEMORY.md`) is still injected whole within its character budgets; this release does not change it.

## Built-in tools

| Category | Tools |
|----------|-------|
| Execution | `bash` |
| Files | `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep` |
| Network | `web_search`, `web_fetch` |
| Interaction | `ask_user` |
| Tasks | `spawn_task`, `todo_read`, `todo_write` |
| Memory / search | `memory_search`, `memory_upsert`, `knowledge_search`, `inspect_conversation_reference` |
| Media | `generate_image`; incoming images go straight to vision-capable models |
| Meta | `discover`, `load_tool`, `load_skill` |
| Schedules | `schedule_list`, `schedule_add`, `schedule_remove`, `schedule_pause`, `schedule_resume`, `schedule_preview` |

**File boundary**: file tools work only inside the project directory authorized for the current turn. Relative paths are rooted there; absolute paths must stay inside it; `~`, `../` escapes and symlinks pointing outside are refused. Only normalized paths that pass the check reach the tool; `glob` / `grep` never start a shell subprocess.

**Network boundary**: network tools get HTTPS access only with `ai.agent.execPreset: network`; `readonly` and other presets never open the network implicitly. `web_fetch` re-checks protocol, domain and SSRF for the initial URL and every redirect; private, link-local, CGNAT and multicast addresses are refused, and the actual connection is pinned to the checked address.

**Todos**: `todo_read` / `todo_write` act only on the current session's plan and accept no `chat_id` or path. State is written atomically to `.zhin/todos`; `.zhin/` as a whole is runtime-private and can't be read or listed by file tools.

## Schedules and the assistant persona

The Assistant runtime turns "do things on a schedule" into a ready-made feature: jobs persist in `data/schedule-jobs.json`, `ScheduleJobEngine` runs them on time, and results go back to chat.

```yaml
assistant:
  enabled: true
  profile:
    enabled: true
    file: assistant.profile.yml   # relative to the project root; this is the default
  events:
    enabled: true                 # expose the POST /api/assistant/events entry point
  defaults:
    notifyOnFailure: false
```

Workspace bootstrap files (`SOUL.md`, `AGENTS.md`, `TOOLS.md`) may write a
`{{nickname}}` slot; prompt assembly replaces it with the current agent's
`ai.agents.<name>.nickname`, or `Zhin` when none is configured, so one SOUL can
serve several bots with different nicknames:

```md
# Who I am

I'm {{nickname}}, a long-time member of these groups.
```

`assistant.profile.yml` declares the persona and routines, synced into scheduled jobs at startup:

```yaml
version: 1
persona:
  soul: You are a thoughtful life assistant.
routines:
  heartbeat:
    enabled: true
    everyMs: 1800000
    prompt: Check todos and report.
  morningBrief:
    enabled: true
    scheduleKind: solar      # solar | lunar | workday | freeDay | holiday
    cron: "0 0 8 * * *"
    tz: Asia/Shanghai
    prompt: Write today's morning brief.
```

- Built-in routines are `heartbeat` (interval), `morningBrief` (08:00 by default), `bedtimeCheck` (22:00 by default) and `weatherReport`; custom keys work too.
- For mainland-China working days use `workday` (it accounts for adjusted working days), not solar `1-5`.
- Users can also ask the AI in chat to manage jobs with `schedule_add` / `schedule_list` / `schedule_preview`; external systems can inject events via `POST /api/assistant/events` and list jobs with `GET /api/assistant/jobs`. From the command line: [CLI · schedule](../cli/index.md#schedule-persistent-scheduled-tasks).

## Per-model tuning

Override execution parameters per provider / model (currently `maxIterations`). Merge order: built-in defaults → `providerPatterns` (with `*` wildcards) → exact `models` keys:

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

## Workroom Kernel

A Workroom lets several Agents **divide work by role** on multi-step tasks in a group, channel or GitHub repository: an Orchestrator understands requests and assigns work, Executors carry it out, Reviewers check it. Unlike ordinary chat, every step is recorded in an append-only journal, so it is auditable and recoverable.

**Neither ordinary chat nor `spawn_task` creates a Workroom automatically** — only explicit Project commands such as `/work` do.

### Core rules

- `WorkroomKernel` accepts only explicit, Project-scoped commands and uses a versioned append-only Journal as the single source of truth for Runs / Tasks / Assignments.
- There is no generic state-transition tool that would let a model fake "executed / accepted". Command adapters must hold an authenticated Project capability and connect the Scheduler, Executor and Acceptance ports separately.
- Human messages first enter a content-free Project Inbox by full space address, then the Orchestrator arbitrates them into tasks. `conversation.agent` identifies the Orchestrator owning that Inbox, but can **never** bypass arbitration to turn a message straight into Task state.
- Once ordinary discussion is persisted, a one-time handoff continues that Orchestrator turn and returns the Agent reply directly. That turn uses a Project-scoped session and a trusted Project / Proposal envelope: it doesn't read the ordinary group-chat session tail, doesn't expose `spawn_task`, and always replies through the Catalog Orchestrator Endpoint's unified outbound chain.
- Replying to a projected card or `@`-mentioning a named member produces an exact TaskInput only when there is **exactly one** active Assignment; otherwise it asks for clarification.
- Only an explicit `/work` creates Runs / Tasks, through the governed planning entry point.

### Declaring a Workroom in Console

Use Console's **Workrooms** menu to declare the Project boundary, Agent members and roles, and the group, channel or GitHub repository it binds. Workroom definitions live in the **persistent runtime Catalog**, not in the `ai` config file; saving takes effect immediately without a restart. The old `ai.workrooms` config is explicitly rejected with a migration hint. The record key is the `projectId` used by the Workroom Kernel:

```json
{
  "projectId": "support",
  "name": "Customer Support",
  "enabled": true,
  "members": [
    { "agent": "zhin", "role": "orchestrator" },
    { "agent": "support", "role": "executor" },
    { "agent": "reviewer", "role": "reviewer" }
  ],
  "conversation": {
    "adapter": "telegram",
    "endpoint": "support-bot",
    "kind": "group",
    "id": "10001",
    "agent": "support"
  }
}
```

| Field | Rule |
| --- | --- |
| `members[].agent` | Must reference an Agent in `ai.agents`, with each role using its own binding |
| `members[].role` | One of `orchestrator | executor | reviewer | integration` |
| `members[].assignmentRoute` | `{ "kind": "local" }` pins local execution; `{ "kind": "remote", "endpointId": "..." }` pins a single A2A endpoint. Omitted means local; remote execution never guesses between endpoints. The route is persisted with the Catalog revision / digest and re-checked before claiming |
| `members[].messageRoute` | e.g. `{ "adapter": "icqq", "endpoint": "reviewer-bot" }`: which bot this member speaks through in a shared group. Omitted means the `conversation`'s main Endpoint. Once set, messages received by that bot in the same group join the same Workroom, and the member's progress, milestones and conclusions are posted by it |
| `sponsors[]` | Authenticated principal ids (e.g. `owner:<platform-user-id>`) allowed to run Project Sponsor controls. This is persistent Catalog authority; self-reported identity in message metadata is never read |
| `conversation` | The ordinary Workroom space |
| `sponsorConversation` | Optional separate `group | channel` Sponsor Room carrying Sponsor commands, lifecycle / overdue notices, and Portfolio lane / queue / grant / budget / fairness cards |

More constraints:

- The `agent` of both conversations must be a member with the `orchestrator` role. An enabled Workroom needs at least one Orchestrator and an ordinary space.
- One Workroom binds one full space address; **one Bot / App Endpoint can serve many Workrooms**, but ordinary Workroom addresses can't be reused or collide with a Sponsor Room.
- Several Projects may declare the same Sponsor Room, forming a Portfolio-level aggregate room, but each projection is still a separate Project view. In an aggregate room, governance commands look like `/control data-lifecycle project <projectId> ...` and Portfolio commands like `/control portfolio <portfolioId> project <projectId> ...`; when replying to a single Project's card you can omit the Project segment. A room address carries no Project authority by itself: if the explicit Project and the replied card disagree, the card revision is stale, or the Endpoint version drifted, you get a clarification, not an executed command.
- At startup or scan time the Host builds Sponsor delivery bindings from the persistent Catalog and current Endpoint capabilities, so the first outbound-only alert doesn't need the room to have received a message first.

### A GitHub repository as a Workroom

The GitHub adapter matches `repository` Workrooms using the stable `repo` metadata (`owner/repo`) from webhooks, so every Issue / PR comment thread in one repository joins the same Workroom:

```json
{
  "projectId": "zhin-repo",
  "name": "Zhin Repository",
  "enabled": true,
  "members": [{ "agent": "zhin", "role": "orchestrator" }],
  "conversation": {
    "adapter": "github",
    "endpoint": "my-github-bot",
    "kind": "repository",
    "id": "zhinjs/zhin",
    "agent": "zhin"
  }
}
```

A GitHub Project Item is an external projection / sync target for a Task, **not** part of the Workroom's identity. Console's Task page currently reads only Journal and Kernel facts; syncing to Project V2 needs a separate Integration Port, an idempotent task-key ↔ item-id mapping and a conflict policy — Console can't change Task state directly. Full design: [GitHub repository Workroom](../solutions/github-workroom.md).

### Planning tasks with `/work`

`/work` never degrades into a single fixed task:

- It creates a Run only when the composition root installs a governed `HumanIngressPlanningPort`; otherwise it persists the request and returns `planning_unavailable` asking for clarification.
- `DynamicWorkflowPlanningPort` is recommended: the model or Strategy returns only an **untrusted** structured DAG candidate, while Project / Catalog, Profile, Orchestrator, planning policy, budget and Sponsor Gate authority are injected by trusted ports.
- `WorkflowPlanBuilder` re-validates the candidate against the Profile capability ceiling, required / optional steps, dependencies and cycles, Task / attempt budgets and approval gates; only `WorkroomKernel.admitWorkflowPlan()` can atomically write Plan / Task facts.
- A Plan Gate first becomes an `approval` Blocker that the ordinary Orchestrator `resolve_blocker` can't clear. With `WorkroomPlanGateAuthorityPort` installed, a human Sponsor can submit an exact, replayable decision with `/control plan-gate <approve|reject|request-changes|cancel> <runId> <taskKey> <gateId> [reason]`.

### Enabling planning for the first time

In Console's **Workrooms → Planning and disclosure**, enter a `projectId` and run diagnostics. Writes need a full token bound to a `principalId`, and that principal must appear both in the Project's `sponsors` and in the process-wide trusted Pack publisher list:

```yaml
http:
  tokens:
    - token: ${WORKROOM_SPONSOR_TOKEN}
      scope: full
      principalId: workroom-admin
ai:
  workroom:
    trustedPackPublishers:
      - workroom-admin
    disclosure:
      modelProviders:
        PROVIDER_ALIAS:
          endpoint: REPLACE_WITH_CONTRACTED_ENDPOINT
          processingRegions: [REPLACE_WITH_CONTRACTED_REGION]
          maxConfidentiality: project_internal
          external: true
          noTraining: REPLACE_WITH_PROVIDER_GUARANTEE
          loggingMode: REPLACE_WITH_LOGGING_MODE
          maximumRetentionSeconds: REPLACE_WITH_MAX_RETENTION_SECONDS
          allowsRedisclosure: REPLACE_WITH_PROVIDER_GUARANTEE
          supportsDeletion: REPLACE_WITH_PROVIDER_GUARANTEE
```

1. The `REPLACE_WITH_*` values are deliberately invalid placeholders and can't be saved as-is. Keys under `modelProviders` must be the `ai.providers` alias used by the Orchestrator; region, training, logging, retention and deletion fields are governance declarations that must match the provider's actual policy and account settings. With OpenRouter, also enable zero data retention and disable data collection in its [Privacy / ZDR](https://openrouter.ai/docs/guides/features/zdr) settings.
2. Save the real config, restart the Host, log in to Console with that token, and add `workroom-admin` to the Catalog Project's `sponsors`.
3. Once diagnostics pass, click "Initialize orchestration". Console publishes a Capability Pack from the current version's real Agent / Tool / Skill digests, activates the first Project Profile, publishes the default Planning Policy, and has the authenticated Sponsor issue Project Data Governance authority.
4. When both Planning and Disclosure show as ready, `/work` can be submitted.

::: warning Back up the data-governance root key
On first issue, a self-hosted Host creates `.zhin/workroom-data-governance-root-key.json` with mode `0600`, used to wrap local data keys and sign authority. Include it in encrypted backups: **if it's lost, existing Payload Vault content can't be recovered.**
:::

::: details Storage backends, Console control planes and remote execution
- **Storage backend**: the Catalog and Run Journal share one persistence choice. With `ai.sessions.useDatabase !== false` they use the database tables `workroom_catalog` / `workroom_events`, and a Database Root Host that isn't ready makes the new version fail to publish; with it explicitly `false` they fall back to atomic file event streams in `.zhin/workroom-catalog.json` and `.zhin/workroom-journal`. The backend is fixed at process start and **can't change on hot reload** — restart the process to change it, so old and new versions never write two facts sources with no CAS relationship.
- **Catalog edits**: saves use revision CAS; member references follow the current version's `ai.agents`, and stale references are rejected. Journal facts of existing Runs are never overwritten by Catalog edits.
- **Read-only projections**: Console's Run list and details are Project-scoped read-only projections (e.g. `GET /api/agent/workroom/runs?projectId=...`) and can't change Tasks / Assignments.
- **Typed control planes** (isolated from each other): Profiles and Project Knowledge are published or rolled back through `workroom.profile.*` / `workroom.knowledge.*` RPC; a Portfolio Sponsor submits exact commands to `POST /api/agent/workroom/portfolio/commands`; an Effect Sponsor uses `POST /api/agent/workroom/effects/sponsor-decisions` to decide only authorizations bound to an exact Intent, accepting only a closed set of `reasonCode`s and storing no free-form explanation; Data Steward / Privacy / Compliance use `/api/agent/workroom/data-lifecycle`, `/overdue` and `/commands` to query lifecycle projections and run Holds, subject erasure / export and retention purge / reconcile — these endpoints are published only when Root-private role authority, the current Catalog Project and the P12 Console recipient all match. Every endpoint re-derives the principal from the authenticated token and re-checks the current Catalog / Profile / governance revision; identity, approval or discussion self-reported in the request body never grants write access.
- **Remote execution**: the optional Remote A2A Executor reuses the same Assignment lease / fence / event contract. A new claim is allowed only when the persistent Profile, Authority Grant, Workspace, Disclosure and the endpoint's Card / auth / transport snapshots all match exactly; anything missing blocks persistently. The old `ai.remoteAgents` poller no longer exists.
:::

### Legacy data

The legacy format (a Journal with embedded payloads) and legacy Runs are no longer supported and have no migration tooling; opening a legacy-format store fails closed. See [Legacy concept migration](../contributing/legacy-concepts.md).

## Related

- [AI overview](./index.md): enabling AI, models, trigger rules and security policies.
- [Agent tools and Skills](../authoring/agent-tools.md): writing Tools, Skills, Prompt Sections and sub-agents.
- [Speech](./speech.md): speech recognition and voice replies.
