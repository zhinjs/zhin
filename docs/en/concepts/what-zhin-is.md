# What Zhin.js Is

> In one line: **Zhin.js is a multi-channel TypeScript IM bot and AI assistant runtime — millisecond leak-free hot reload on file save, write-once JSX that auto-degrades across 20+ chat platforms, a <10MB IM core, and an optional governed multi-model AI Agent.**

To start building right away, jump to [Getting Started](../getting-started/index.md) or [Directory Conventions](../authoring/conventions.md). This page explains **why developers choose Zhin.js** and what happens to a message inside the runtime.

## Four reasons developers choose Zhin.js

### 1. Convention-Driven Capabilities & Leak-Free Hot Reload

Drop files into `commands/`, `components/`, `middlewares/`, `tools/`, or `schedules/` and Zhin discovers them automatically — no central routing boilerplate required.

Every time you save a file or edit configuration, Zhin builds a complete new **Generation** in the background:
- If new code throws a syntax error or fails to connect, the candidate generation is discarded and **the previous version keeps serving without interruption**;
- In-flight messages finish on the generation snapshot they started with, while new messages use the new generation;
- Timers, listeners, and connections registered on `context.lifecycle` are disposed automatically when an old generation retires — eliminating duplicate timers and memory leaks across hot reloads.

See [Plugin Model](./plugin-model.md) and [Generation and Lifecycle](./generation-lifecycle.md).

### 2. Write JSX Once, Auto-Degrade Across 20+ IM Platforms

Chat platforms differ wildly in rich-media support (Discord and Telegram have native buttons, plain group chats only support text, and some platforms work best with rendered images). In Zhin, commands and components simply return JSX:

```tsx
return (
  <card title="Deploy Confirmation">
    <text>Ready to release v1.2.0 to production</text>
    <button onClick={async (msg) => '✅ Deployment started'}>Deploy Now</button>
  </card>
);
```

- **Native interactions with automatic fallback**: Platforms with native interactive buttons render real buttons; plain-text group chats automatically fall back to a numbered text menu (replying with the number triggers the exact same `onClick` handler, scoped safely to that conversation and generation).
- **HTML to crisp images**: Visual components inside `<html>...</html>` (`@zhin.js/components`) are rendered into images on the fly via `@zhin.js/html-renderer`.

### 3. Unified Inbound/Outbound Pipeline & Multi-Endpoint Routing

Whether you connect to QQ (ICQQ / NapCat / OneBot 11·12 / Official Bot), Discord, Telegram, Feishu, DingTalk, Slack, KOOK, WeCom, or the built-in local `/sandbox`:

- **One message and conversation contract**: Plugins always work with the same `Message`, `Segment`, and structured `ConversationRef`.
- **Single auditable outbound pipeline**: Every reply (`message.$reply` or command return value) flows through `render → outbound middleware → platform endpoint`, so logging, moderation, and rate-limiting apply everywhere.
- **1:N multi-account expansion**: Configure multiple entries under `endpoints: [{ id: ... }]` in `zhin.config.yml` to run several bot accounts side by side on a single adapter instance.

See [Message Flow](./message-flow.md) and [Config as Data](./config-as-data.md).

### 4. Lightweight IM Core (<10MB) + Governed AI Agent on Demand

By default, Zhin installs only the IM core (under 10MB in production `node_modules`) with zero LLM SDK dependencies. When you want AI capabilities, run `npx zhin setup --ai` to add `@zhin.js/agent`:

- **Multi-model routing (`ai.plan.yml`)**: Route `chat`, `compaction`, `ambient` group listening, and media `perception` to different model profiles (OpenAI, DeepSeek, Qwen/DashScope, SiliconFlow, Volcengine, Anthropic, or local Ollama).
- **Progressive tool & skill disclosure**: Tools and `SKILL.md` instructions are tiered by scene and loaded on demand, keeping the system prompt prefix byte-stable to maximize LLM prompt cache hits.
- **Trust tiers & dangerous-action hard gates**: Group members, trusted users, and bot owners get strictly separated tool permissions. High-risk actions (kicking, muting, group announcements, self-change) require fresh human approval via Console cards or owner `/approve` commands.

See [AI Capabilities Overview](../ai/index.md) and [Agent Deep Dive](../ai/agent.md).

## How the runtime is divided

```text
            ┌──────────────────── Platforms (QQ / OneBot / Discord / Feishu / …) ───────────┐
            │                                                                               │
  Adapter ── declares a capability profile (supported segments, actions, interactions)      │
            ── implements ports ── maps raw platform events to canonical events             │
            ▼                                                                               │
  Zhin runtime ─ contracts: Generation transactions · JSX/component rendering · capability  │
                 negotiation · audit trail · dangerous-action hard gate                     │
            ▼                                                                               │
  Plugins / Agent ─ focus on features: commands, JSX components, middleware, tools & skills ┘
```

The rule: **Zhin provides the contract; adapters declare what each platform can do; plugins and the Agent act on the combined capabilities for the current turn** without hard-coding `if (platform === '...')` branches.

## What happens to one message

1. **Ingress & normalization**: The adapter converts a raw platform event into a canonical `Message` with sender roles and scene metadata.
2. **Capability negotiation**: The adapter's capability profile is narrowed by the conversation kind (group / private / channel) and current bot state (admin role, mute status).
3. **Middleware & command dispatch**: Inbound middleware runs first; if a command prefix matches, the command executes. Otherwise `ai.trigger` decides whether the AI Agent should handle the message.
4. **AI reasoning & tools** (when AI is enabled): The system prompt is assembled with a cache-friendly stable prefix and token-budgeted history; the model calls permitted tools, and dangerous actions pause for hard-gate approval.
5. **Outbound rendering & delivery**: JSX, components, or structured AI replies are normalized into canonical segments, adapted or auto-degraded for the target platform, passed through outbound middleware, and delivered.

## Where to read next

- **Build your first plugin**: [Getting Started](../getting-started/index.md) → [Directory Conventions](../authoring/conventions.md) → [Plugin Model](./plugin-model.md)
- **Connect an LLM and write tools**: [AI Capabilities Overview](../ai/index.md) → [Agent Tools and Skills](../authoring/agent-tools.md)
- **Understand hot reload & config transactions**: [Config as Data](./config-as-data.md) → [Generation and Lifecycle](./generation-lifecycle.md)
- **Write a platform adapter**: [Adapters](../authoring/adapters.md)

::: details Architecture Decision Records (ADR Index)

The following internal Architecture Decision Records (ADRs, written in Chinese) document the design behind Zhin's group behavior, controlled operations, token budgets, and adapter capability profiles:

| ADR | Topic | Key mechanism |
|---|---|---|
| [0034](../../adr/0034-activity-feedback-service-plugin.md) | Activity feedback service | Typing indicators, emoji reactions, and progress messages in chat |
| [0035](../../adr/0035-comment-reply-adapter-contract.md) | Comment-reply adapter contract | Canonical inbound/outbound contract for comment-based platforms |
| [0036](../../adr/0036-controlled-landing-phase0.md) | Controlled landing phase 0: audit, control plane, hard gate | Per-turn decision audit, emergency stop / mute control plane, fresh human approval |
| [0037](../../adr/0037-controlled-landing-phase1-group-ops.md) | Phase 1: group operations | Welcome flows, approved announcements, quiet-field cooling, moderation cooldowns |
| [0038](../../adr/0038-continuous-input-merge.md) | Continuous input merge (busy groups, danmaku) | Merging simultaneous mentions into one reply and live danmaku windows |
| [0039](../../adr/0039-group-ops-rules.md) | Dynamic group-ops rules | Owner-approved violation ladders with automatic mutes and per-call kick approval |
| [0040](../../adr/0040-controlled-self-change.md) | Controlled self-change | Agent draft → sandbox trial → human approval → apply with automatic rollback |
| [0041](../../adr/0041-prompt-segments-and-message-headers.md) | Prompt segments and message headers | Byte-stable five-segment system prompt prefix and compact speaker headers |
| [0042](../../adr/0042-first-turn-token-budget.md) | First-turn token budget | Cache breakpoints, scene-tiered tools with call-to-load, `SOUL.md` scope tags |
| [0043](../../adr/0043-history-token-budget.md) | Conversation-only history, token-budget window, quotes | Token-budgeted sliding window, trimmed old tool results, inline quote excerpts |
| [0044](../../adr/0044-adapter-capability-profile.md) | Adapter capability profile | Seven capability groups, dynamic narrowing, shared OneBot event mapping |
| [0045](../../adr/0045-current-message-runtime-context.md) | Current-message runtime context after the body | Placing per-turn runtime context after the message body to preserve prompt cache |
| [0046](../../adr/0046-personal-session-model-policy.md) | Personal Sessions, model catalog and scope policy | Per-user session isolation, model Profile routing, and scoped overrides |
:::
