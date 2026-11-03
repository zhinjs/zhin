---
title: "Letting the Bot Change Itself"
description: "Ask the bot to \"add a command / change a setting\": who may draft, trial before publish, one approval then automatic reload or restart with a report back, and what can never be changed"
---

# Letting the Bot Change Itself

Tell the bot in a DM "add a `/ping` command that replies pong" or "set the weather plugin's default city to Shanghai". The bot drafts the change, trial-runs it in a sandbox, and sends you an approval card. Approve once and it takes effect on its own — hot reload when possible, an automatic restart when not — and then it reports back in the conversation you started from: "applied" or "failed, rolled back".

Design and defaults: [ADR 0040](../../adr/0040-controlled-self-change.md) (Chinese). Runtime details for every step: [Default Behavior](./default-behavior.md#dangerous-tool-hard-gate).

## Who can ask

- The bot's **owner** (endpoint owner / `trigger.masters`) and **IM approvers** (`approverIds` while `ai.agent.toolHardGate.imApproval` is on).
- Everyone else — group members, group admins, trusted members, strangers in DMs — does not see this capability: the bot will not draft for them, and a forced call is refused and audited.
- At most 1 change waits for approval per conversation and at most 3 per instance; when full, the bot asks you to settle existing cards first.

## How a change flows

1. **Draft**: the bot hands complete file contents and a field-level config patch to the host, which stages them in `.zhin/changes/`. Nothing in production is touched and nothing takes effect yet.
2. **Trial** (next section): if it fails, no card is sent; the bot gets the errors and drafts again.
3. **Approval**: the card **always** goes to the owner's DM — even if you asked in a business group, and saying "OK" in a business group does not count. It lists the files, lines added / removed, config paths touched, whether a reload or a restart is needed, and the trial verdict. Reply `/approve <card id>` or `/deny <card id>` in the DM, or settle it through the Console approval RPCs. Unanswered cards expire after 24 hours.
4. **Apply**: plugin-only changes hot reload; changes that need a restart (for example host sections such as `http` or `database`) trigger a controlled restart followed by a health check.
5. **Report**: back in the original conversation ("applied", noting a restart if one happened); if that conversation is unreachable (group gone, bot removed or muted) the report goes to the owner's DM.

You approve **this exact content**: the approval is bound to a content hash, and a mismatch after approval is refused.

## Sandbox first, then publish

Code the bot writes never goes straight into production. Before the card is sent the host automatically runs:

- **Static checks**: syntax, default-export shape for convention directories, forbidden imports, `SKILL.md` / `agent.json` parsing;
- **Sandbox load**: assembles the drafted plugin in a throwaway child process with no real platform and no model, and checks that its commands / tools are discovered;
- **The plugin's own tests**: in an isolated, offline, read-only, resource-limited container.

When the machine cannot run a check (no Docker, the plugin has no tests, …) it is recorded as skipped: this **does not block** submission, but the card's trial verdict shows how many checks were skipped (e.g. "passed (2 skipped)"). Look twice before approving such a card.

Trial passed, one human approval, written to the production directories — that is "publishing". There is no second approval.

## When something goes wrong

- Health check fails after apply: the bot **rolls back once** from its snapshot and reports "failed, rolled back" with the reason.
- Still unhealthy after the rollback: an instance-level **emergency stop** opens, only the owner's DM is told, and there are **no more automatic restarts** until you deal with it (the evidence is kept until you mark it handled in the Console).
- An unconfirmed configuration save/application or a superseded revision stops automatic continuation and retains evidence for manual verification. It does not retry or overwrite another edit. Here, `failed` means the flow stopped; it does not prove the configuration was not applied or itself enable emergency stop. Recovery also checks the durably acknowledged revision, and retains older records when ownership cannot be proved.
- Process killed mid-apply: the next start checks durable progress and configuration ownership. Confirmed operations retain snapshot rollback and health checks; unconfirmed writes or applications retain evidence for manual verification.
- Process exited right after approval: on the next start, approvals younger than one hour are applied; older ones expire and the owner gets "approval expired, please draft again".

## Automatic restarts need the supervisor

Automatic restarts rely on the `zhin start` supervisor. Without it (running the runtime with bare `node` or some container entrypoints) or with `--once`, the bot tells you this instance cannot apply such changes automatically, and changes that need a restart are **not** submitted for approval. Hot-reload-only changes are unaffected.

## What no grant can loosen

- Every approval is a **fresh human approval**: `bypass`, auto-review, the owner role, remembered grants and `danger-full-access` cannot approve for you.
- The bot may only write plugin convention directories (`commands/`, `middlewares/`, `handlers/`, `tools/`, `components/`, `skills/`, `agents/`, in the project root or a local plugin inside the project), the root `AGENTS.md` and `skills/**`; root config can only be patched field by field, never overwritten as a file.
- Never writable: `node_modules`, lockfiles, `.env*`, `.zhin/` and other host files.

The configuration allowlist is unchanged: the self-change tool can directly patch only `ai.trigger.ambient` within Host settings, and the default CLI still marks it pending restart. Model provider/model fields are outside this tool's Host allowlist. A trusted Host receipt confirming every pure configuration change applied avoids a redundant restart; approval and the pre-write supervisor gate remain unchanged.

## Config the bot cannot change

Any setting that would loosen security or widen the tool surface is refused at draft time — no card is sent. For example:

- under `ai.agent`: the dangerous-tool hard gate (`toolHardGate`, including the IM approver list), exec approval and exec security (`execApprovalMode`, `execSecurity`, `execPreset`, `execAllowlist`, …), the owner shell, injection guard, the owner's quota exemption, schedule security;
- `ai.decisions.approval`, `http.token` / `http.tokens`, `a2a` remote executors and callbacks, `mcp` / `ai.mcpServers` (a new MCP server means new tools), and more.

The full list is in [Default Behavior](./default-behavior.md#dangerous-tool-hard-gate). Edit these in the config file yourself.

## Not supported yet

- **Creating a new plugin package** (a new `plugins/<name>/package.json` and entry) and **installing npm dependencies**: out of scope for now — install dependencies and create the plugin yourself, then ask the bot to add commands to it.
- **Reviewing the full code diff before approving**: the Console "self-change" detail page and diff excerpts on the IM card (#1051 F3) are **not available yet**. Today the card carries files, line counts, config paths, impact and the trial verdict — no file bodies or config values.
- Changing the zhin framework itself, approving several changes together, pushing changes across instances, a visual editor.
