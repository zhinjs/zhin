# What zhin Is

> In one line: **zhin is a runtime that lets an AI live in IM groups for the long run — it talks like a person, follows the rules, keeps costs in check, and works on any platform.**

This page ties the designs spread across the ADRs into one picture. To write a plugin, start with [Plugin Model](./plugin-model.md); for how messages move, see [Message Flow](./message-flow.md). This page explains *why* things are the way they are.

## The picture

```
            ┌──────────────────── Platforms (QQ / OneBot / Discord / …) ────────────────────┐
            │                                                                              │
  Adapter ── declares a capability profile (what it can do, per conversation kind)        │
            ── implements ports (how to do it) ── maps raw events to canonical events      │
            ▼                                                                              │
  zhin runtime ─ the spec: capability catalog · segment assembler · message/event          │
                 contracts · audit · hard gate · control plane                             │
            ▼                                                                              │
  Plugins / Agent ─ decide, from this turn's combined capabilities, what to say,          │
                    which tools to offer and which actions are possible ──────────────────┘
```

The rule: **zhin provides the spec; adapters inject capabilities by that spec; plugins build features from the combined capabilities.** Core code never says "if this is platform X"; every difference comes from what the adapter declares ([ADR 0044](../../adr/0044-adapter-capability-profile.md)).

## Four goals and what supports them

### 1. Humanlike — how it behaves in a group

| Design | What it does | Source |
|---|---|---|
| Ambient listening | Reads the group without being @'d and decides whether to speak; may stay quiet even when @'d | ambient engagement |
| Headers only when needed | Name / role / title appear on someone's first message and when they change; a short header otherwise | [0041](../../adr/0041-prompt-segments-and-message-headers.md) |
| State changes in history | Joins, leaves, card changes and promotions are part of the conversation | 0041 |
| Quotes understood inline | A quoted message in context gets `reply_to`; otherwise an inline excerpt — no extra tool call | [0043](../../adr/0043-history-token-budget.md) |
| Continuous input merge | Several people @'ing at once get one reply that addresses each; danmaku picks one | [0038](../../adr/0038-continuous-input-merge.md) |
| Restrained reactions | Stickers and emoji reactions have cooldowns and randomness | reaction pacing |
| Persona vs rules | `SOUL.md` holds personality and tone; general rules live in the system prompt | bootstrap scopes ([0042](../../adr/0042-first-turn-token-budget.md)) |

### 2. Controlled — you can always rein it in

| Design | What it does | Source |
|---|---|---|
| Decision audit | Every wake, block, allow, tool call and outbound is recorded and replayable per turn | [0036](../../adr/0036-controlled-landing-phase0.md) |
| Control plane | Emergency stop, mute, read-only, mention-only; instance and conversation levels with revisions | 0036 |
| Dangerous-action hard gate | Kick, mute, announce, editing host config… need a fresh human approval; bypass and remembered grants don't count | 0036, #1030 |
| Group operations | Welcome, approved announcements, quiet-field cooling, schedule reminders, moderation cooldown | [0037](../../adr/0037-controlled-landing-phase1-group-ops.md) |
| Approved-once rules | Once an owner approves a violation ladder, mutes run automatically; kicks still need approval each time | [0039](../../adr/0039-group-ops-rules.md) |
| Controlled self-change | Draft → trial → human approval → apply/restart → report back; one rollback, then emergency stop | [0040](../../adr/0040-controlled-self-change.md) |

Principle: **the model may propose; loosening limits and dangerous actions need a person, and you can always see who approved what.**

### 3. Affordable — cheap enough to stay

| Design | What it does | Source |
|---|---|---|
| Segment assembler | System → environment → role rules → platform → scene; the first four are byte-stable across sessions | 0041 |
| Stable prefix + cache breakpoint | Scene goes last, so even a new session's first message hits the cache | 0042 |
| Tool tiers, call-to-load | Group chats keep only chat essentials loaded; calling by name auto-loads; the tool list only appends | 0042 |
| History stores conversation | Per-turn context (time, rules, tool index…) is never stored; the window is a token budget | 0043 |
| Old tool results trimmed | Finished turns keep the first 200 chars of each result | 0043 |
| Fewer rounds | Per-scene iteration limits, spin detection, parallel calls | 0042 |
| Real ledger | `zhin usage report` and the Console "Token usage" page by model / session / time, with cache hits | 0043, Console |

Goal: **cost grows linearly with groups and messages, not with accumulated history.**

### 4. Platform-neutral — composed capabilities, not hard-coded branches

| Design | What it does | Source |
|---|---|---|
| Capability profile | Adapters declare seven groups (messaging, scene, actions, events, feedback, delivery, prompt) per conversation kind | 0044 |
| Dynamic narrowing | Current facts (bot role, mute, passive window) can only narrow, never widen | 0044 |
| Generated platform notes | The prompt's platform section is generated from capabilities; adapters may add their own text | 0044 |
| Shared event mapping | OneBot / NapCat / icqq share one raw → canonical event mapping | 0044 |
| Tools follow capabilities | Tools declare `requiresCapabilities`; if the bot isn't admin, the mute tool doesn't appear | 0044 |

## What happens to one message

1. **Ingress**: the adapter turns a platform message into a canonical one; the trusted ingress adds sender roles and scene facts (group name, owner, admins, bot role — two-level cache).
2. **Capabilities**: the profile is merged for the conversation kind, then narrowed by current facts.
3. **Admission**: merge window, control plane (stop / mute / mention-only) and the session gate decide whether and when the model runs.
4. **Assembly**: the system prompt is assembled from segments (stable prefix + scene); history is cut to the token budget and holds only conversation; the current message carries this turn's context.
5. **Reasoning and tools**: the model only sees tools allowed by both capabilities and permissions; dangerous tools go through the hard gate.
6. **Outbound**: the structured reply is rendered, degraded and delivered per platform capabilities; reactions are paced; everything is audited.

## ADR index

| ADR | Topic |
|---|---|
| [0034](../../adr/0034-activity-feedback-service-plugin.md) | Activity feedback service |
| [0035](../../adr/0035-comment-reply-adapter-contract.md) | Comment-reply adapter contract |
| [0036](../../adr/0036-controlled-landing-phase0.md) | Controlled landing phase 0: audit, control plane, hard gate |
| [0037](../../adr/0037-controlled-landing-phase1-group-ops.md) | Phase 1: group operations |
| [0038](../../adr/0038-continuous-input-merge.md) | Continuous input merge (busy groups, danmaku) |
| [0039](../../adr/0039-group-ops-rules.md) | Dynamic group-ops rules |
| [0040](../../adr/0040-controlled-self-change.md) | Controlled self-change |
| [0041](../../adr/0041-prompt-segments-and-message-headers.md) | Prompt segments and message headers |
| [0042](../../adr/0042-first-turn-token-budget.md) | First-turn token budget |
| [0043](../../adr/0043-history-token-budget.md) | Conversation-only history, token-budget window, quotes |
| [0044](../../adr/0044-adapter-capability-profile.md) | Adapter capability profile |
| [0045](../../adr/0045-current-message-runtime-context.md) | Current-message runtime context after the body (prompt cache) |
| [0046](../../adr/0046-personal-session-model-policy.md) | Personal Sessions, model catalog and scope policy |

ADRs are written in Chinese.

## Where to read next

- **Writing a plugin**: [Plugin Model](./plugin-model.md) → ADR 0044 §5 (how plugins use capabilities).
- **Writing an adapter**: [Adapters](../authoring/adapters.md) → ADR 0044 (profile, ports, event mapping).
- **Tuning persona and group experience**: `SOUL.md` / `AGENTS.md` and scope annotations (0042 §5) → 0041 headers.
- **Control and rollout**: 0036 → 0037 → 0039 → 0040.
- **Watching cost**: `zhin usage report`, Console "Token usage" → 0042, 0043.
