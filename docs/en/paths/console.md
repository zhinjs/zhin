---
title: "Console path: manage a running bot in the browser"
description: "Connect Console, find the right page for each task, inspect messages and AI runs, manage Workrooms, and diagnose problems in a fixed order"
---

# Console path: manage a running bot in the browser

Console is Zhin's web admin panel. Without signing in to the server, you can check whether the bot is online, send and receive messages, see each step the AI took, and track down errors.

When you're done you'll:

- know which page to open for each task;
- be able to trace a message to the AI's steps and logs;
- tell a read-only Demo token from a Full token that can make changes.

::: tip Console and the bot are separate
Console is a standalone web app ([console.zhin.dev](https://console.zhin.dev)); your bot process (the Host) only exposes token-protected APIs. One Console can therefore connect to bots on different machines.
:::

## 1. Connect the Host

1. Start the Bot and copy the API Base printed by the terminal.
2. Open [console.zhin.dev](https://console.zhin.dev).
3. Use `HTTP_TOKEN` from the project `.env` file.

Projects created by the scaffold default to port `8068`, but go by the terminal output or `http.port` in your config. If you can't connect, run `npx zhin doctor` first.

## 2. Choose a page by task

| Task | Page | Source of truth |
| --- | --- | --- |
| Judge system health | Home | Endpoint, log, Agent, and action summaries |
| Send messages or handle requests | Chat accounts | Endpoints, sessions, messages, notices, requests |
| Look back at what the bot and people said | Chat history | AI conversations per session; continue from any point |
| Try the bot without a platform account | Try a chat | built-in simulated chat (Sandbox): send a message, see the reply |
| See how the AI handled a message | Bot status | each run's steps, tool results, cancel and retry actions |
| Manage multi-Agent projects | Workroom (Advanced) | tasks, assignments, reviews, and approval gates in a project |
| Confirm a command or tool is actually loaded | Runtime Capabilities (Advanced) | commands, middleware, components, Tools, Prompt Sections, MCP |
| Diagnose a failure | Activity log | level, source, timeline, details |
| Change the system | Advanced → Config, Environment, Project files, Database | full-scope administration only |

**Configured doesn't mean active.** To know whether something is available, go by what **Runtime Capabilities** shows as currently loaded.

## 3. Send and receive messages

In **Chat accounts**, pick an Endpoint (one account the bot is signed in to on a platform) and a conversation to read and send messages. New messages arrive live; saved history is still there after a refresh.

::: details Why can't I see older history on some platforms?
The page receives live events over SSE and pulls history over HTTP; after a reconnect with a gap, it reloads the current conversation. If a platform's adapter has no history API, Console can only show what the bot saved itself while running.
:::

## 4. See what the AI did

**Bot status** lists every AI execution (a Run). Open one to see each model step, which tools were called with what results, and whether it was cancelled. You can also cancel a running task here or export a report of the run.

The workbench can also open lab sessions: choose a working directory and security policy when you start; the Host saves the session so it survives a refresh.

::: details How do I know which message a run belongs to?
Each run is uniquely identified by `runtimeId + turnId`; don't guess from time or message text. The tools, Prompt Sections, and MCP servers in use are fixed when a run starts, so saving code midway doesn't affect it.
:::

## 5. Manage Workrooms

A Workroom is a space where several Agents work on tasks together, bound to a group, channel, or GitHub repository; one bot account can serve several Workrooms. For the concept, see [Agent deep dive](../ai/agent.md#workroom-kernel).

- **Workroom Configuration**: create or edit a Workroom; changes apply on save with no restart. Member Agents must already be configured in `ai.agents`.
- **Board**: see the current state of tasks, assignments, reviewers, and approval gates.

::: details Where is the config stored? Can I change task state on the board?
Workroom configuration from Console is stored in the persistent Runtime Catalog and is **not** written back to `ai.workrooms` in `zhin.config.yml`. The board is a read-only view of the Workroom Journal (an event log); Console can't rewrite task state directly, and every change goes through an authenticated control interface.
:::

## 6. Full token vs Demo token

| | Full token | Demo token |
| --- | --- | --- |
| View status, capabilities, and runs | ✅ | ✅ |
| Send messages; change config, environment, files, database | ✅ (per Host policy) | ❌ |
| Read raw YAML config | ✅ | ❌ |

A token is a password: keep it out of URLs, screenshots, and public frontend config.

::: details Can't connect to a remote deployment?
Set `http.corsOrigins` to allow Console's origin. Behind a reverse proxy, forward the API, SSE, WebSocket, and page assets together; proxying ordinary HTTP alone breaks live messages or page loading. See [Production](../operations/production.md).
:::

## Edit configuration with forms

Configuration opens with all fields described by the Host Schema, including Host sections that are not yet saved. Nested objects, arrays, dictionaries, unions and scalar sections retain saved values and environment references. Calendar, reminder, repeater and short-url publish static Schemas, so disabled instances can be configured without executing their code.

Each section has an optional highlighted JSON source view sharing its form draft. Invalid JSON stays visible and blocks saving until corrected. Switching sections preserves drafts. The separate full YAML/JSON source editor uses the saved file and does not silently combine unsaved section drafts.

Arbitrary JSON and unresolved recursive or external references use a field-level JSON editor; other fields remain forms. Missing third-party Schemas are reported explicitly instead of inferring types from saved values. Manage instance declarations such as `plugins` and `disable_plugins` through plugin management.

## Check whether configuration was applied

A plugin form shows the file revision it read. Edited values are drafts, not evidence that the file or Runtime changed. After saving, the actual receipt distinguishes system changes requiring a restart from plugin changes awaiting verification. It never declares the business feature ready. The full-source editor also shows the actual revision without claiming every change requires a restart.

Use the application-evidence action in a declared plugin's form to compare one file revision, package version and current generation. Applying saved configuration is available only when evidence matches the read revision, no unsaved draft exists and the Host permits application. After confirmation, the page checks the result through read-only queries. A lost receipt or failed query is unknown, not a reason to submit another application request. Read the evidence again or inspect Host logs.

Configuration semantics matching the current generation means only that this plugin's saved configuration matches its runtime values, including declared defaults. Formatting can change the file revision without changing those semantics. This does not prove the entire file was applied, platform connectivity or business acceptance. If the file or generation changes during inspection, the Host asks for another read instead of attaching an old result to a new revision.

This view does not expose final values without reliable redaction or infer an old generation's default origins from the current file. Environment checks and business verification retain their own timing and limits. Schemas that cannot be safely edited still fall back to source mode.

### Read field origins and current-generation agreement

On the plugin configuration page, choose **读取已保存版本解释** (read saved-version explanation). The action reads the file revision already loaded by the page, not an unsaved draft. It requires full scope and versions of both the Host and standalone Console that provide this feature.

`file` means the static field is present in the file; `schema-default` means the declared default fills the saved candidate during this read; `unset` means it remains absent. `equal` proves only agreement with this instance's current generation at read time. It does not prove that an older generation came from the same file or default; historical generation origins remain unknown. Sensitive fields and environment references are hidden and not compared. Final values, default values and environment variable names are never displayed.

The first version supports static object/scalar Schemas, including the current Reminder and Repeater declarations. Any array, dictionary, composition branch or reference makes the whole explanation unsupported. Calendar's current union falls outside this scope; GroupSuite and RSS have no declared configuration Schema. Continue with **查看完整源码** (view complete source); the existing source fallback preserves fields. Reading an explanation does not change saved or applied state or request application automatically. Read again if the file or generation changes during inspection. See the [Console protocol boundaries](https://github.com/zhinjs/zhin/tree/main/packages/console/protocol).

## 7. When something breaks, check in this order

If the inbound message is visible in a conversation, open its **Diagnostics** action first. It queries the exact conversation and platform message ID, showing observed origin, prefix, middleware, command outcome and reply delivery facts. It never replays the message.

- `completed` means inbound processing ended. Routing to an Agent does not prove the Agent turn finished.
- Delivery `sent` means the Endpoint returned a message ID, not that a remote client displayed it. For `deliveryUnknown`, check the original conversation before any manual resend; no automatic retry is performed.
- Each IM Runtime keeps at most 500 records in memory for 15 minutes. Restart, expiry and capacity eviction remove records; an absent record proves neither success nor absence of receipt.
- Reading diagnostics requires an explicitly configured and validated full-scope token, including on an otherwise tokenless Host. Message bodies, sender profiles and raw exceptions are not copied into this store. Each record holds at most 32 steps and 32 deliveries; `truncated: true` marks an incomplete record when these limits are exceeded. Identity fields are limited to 2048 characters and conversation JSON to 8192; oversized identities are omitted instead of truncated into ambiguous addresses. This is not a complete audit log.

The Host endpoint is `GET /api/messages/diagnostics`: use `id` for one record, or `conversation` (complete `ConversationRef` JSON) and `messageId` for an exact lookup; `limit` accepts 1–100. Follow the observed result in [message troubleshooting](../troubleshooting/messages.md); newer Console versions also link to the relevant topic from each diagnostic. When no record is available, continue below. Older Hosts do not expose this endpoint; update the Host and standalone Console separately.

1. **Home**: is the bot connected? Are the Endpoints online?
2. **Chat accounts**: did the user's message reach the bot?
3. **Runtime Capabilities**: is the command, tool, or Prompt Section loaded?
4. **Bot status**: which step did the AI reach, and how did it end?
5. **Activity log**: filter to the same time window and source to find the error.

## Administrator task center

The task center (`/tasks`) starts with practical use cases and reads the task services that running plugin instances actually provide. If the reminder plugin is missing or not loaded, it offers the existing installation path. Select an exact instance when a package has several. Older Hosts need an update alongside the standalone Console.

The first supported provider is persistent administrator reminders. Configure a Database Host, then select a loaded reminder instance, delivery account, conversation kind and ID, including parent and thread identities when present. Accounts come from actual Endpoints. Enter an exact target manually when the platform has no directory; a display name is not an identity. Review the target, absolute time with an explicit timezone offset, content and future delivery effects before creating. A successful creation means the task was saved, not that the platform is online or a message was delivered.

Administrator tasks have separate storage and quotas from personal reminders created in chat. Chat tasks remain owned by the real sender; Console neither impersonates a platform user nor lists or cancels personal reminders. Task management requires an explicitly configured, verified full-scope Bearer Token. Tokenless and demo access are rejected.

Available actions come from the plugin. Pause a scheduled task before editing or resuming it; cancellation cannot retract a delivery already in progress. An `unknown` delivery only permits cancellation after checking the target, with no retry or resume. A fixed interval is a number of seconds, not a local-calendar schedule at the same hour each day. Administrator time fields still require ISO timestamps with an offset; the [reminder guide](../solutions/reminders.md) covers limited natural-time input and follow-up questions for personal chat reminders. RSS instances with durable state, exact outbound delivery and scheduling also expose independent administrator subscriptions. Initial and resumed checks only establish a baseline; see [feed updates](../solutions/rss-subscriptions.md). Other task sources require their own integrations.

Drafts retain their original generation and revision; conflicts preserve input instead of silently overwriting. A timeout or lost response retains the operation ID and freezes writes while reading durable provider receipts. A missing receipt does not prove the command never ran. After changing login, explicitly confirm the original operation identity before reconciling; the page never resends automatically. Temporary reconciliation metadata contains no task content, parameters or credentials.

Host endpoints are `GET /api/tasks/use-cases`, `GET /api/tasks/providers`, `POST /api/tasks/create` and `POST /api/tasks/change`. The plugin owns persistent task facts, revisions and receipts; the Host does not add another scheduler. See the [persistent reminder plugin](https://github.com/zhinjs/zhin/tree/main/plugins/utils/reminder) and [CLI use-case guide](../cli/index.md#use-cases-find-a-setup-path-by-purpose).

## Configure welcomes by use case

Open **Task center → Start by use case → Configure member welcomes** (`/use-cases/group-welcome`). The page reads the Host-selected package and manageable instances; explicitly select among aliases instead of inferring one from a package name. If needed, open Marketplace to review an exact version and the existing installation plan. Configuration, precise conversation scopes and application remain in their original form and plugin details. This flow links navigation and read-only facts; it does not automatically save, apply or send.

On return, separately inspect current-generation configuration semantics, nonempty welcome text and scope, then select a complete test-group identity. After a real member joins, explicitly record a human observation. It is not platform acceptance, and the system does not attribute the welcome to an instance automatically. The record lives only in this page’s memory and is invalidated by changed connection, instance, configuration, generation or target, or a failed read. Empty messages, empty lists and unapplied configurations do not establish readiness; raw environment references cannot prove expanded text or actual scope. See [welcome configuration and human checks](../solutions/group-welcome.md).

## Command permission explanations

Open `/permissions` or follow the permission explanation link in the command catalog. Use an explicit full-scope Token for the current Host. Search by command, description or plugin instance; the catalog is paginated.

Selecting a command explains its actual `permit` declarations and its separate `adapter` constraint. Rule arrays use AND; comma-separated values within one rule use OR. Optionally supply a hypothetical conversation, sender and roles to check builtin conditions. Accounts come from the current Host's complete Endpoint catalog; no platform role lookup is performed.

A matching condition is not authorization. Missing roles remain unknown; platform and custom checkers stay unevaluated. The page executes no command, dynamic parameter default or checker. Builtin conversation rules compare kind and ID only, without restricting the specific Bot account, parent or thread. Displaying a complete identity does not add those restrictions.

Changing assumptions clears old results. A generation change requires a fresh catalog and check. Changing Host or credentials discards old results. Older Hosts without these interfaces receive an explicit update message rather than an invented decision.

For actual welcome restrictions, configure the [exact welcome allowlist](../solutions/group-welcome.md) through the existing validation, save and apply flow. The explanation page does not write it.

## Next steps

- [Console overview](../console/): how Console and the Host split work, and page extensions
- [Agent deep dive · Workroom Kernel](../ai/agent.md#workroom-kernel): Workroom rules and configuration
- [Community bot](../showcase/community-bot.md): a multi-platform production example
