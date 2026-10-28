# Default Behavior Specification

This is the **single authoritative document** for `ai.agent.*` default behavior (#735). Code defaults live in `packages/im/agent/src/config/zhin-agent-defaults.ts`; see the [generated config reference](/en/configuration/generated) for field details.

## Defaults by scenario

| Scenario | Trust level | Default behavior |
| --- | --- | --- |
| Owner DM | owner | All enabled tools; no shell while `execSecurity: deny`; with `masterShell: isolated`, an isolated bash only in the owner's DM; auto-continue on tool-budget exhaustion (`autoContinue: master_dm`, max 2); progress updates in private only |
| Group chat | group_member | Inbound queue `groupMode: supersede` (newer message replaces queued turns, max 5 queued); high-risk external content needs confirmation; outbound content redacted (`outboundCheck: redact`) |
| Trusted member | trusted_member | Same guardrails as group members plus trusted tools; non-IM ingress (CLI, HTTP) counts as trusted_member |
| Stranger DM | group_member | Treated as a group member; no elevation |
| Unattended schedule | — | `maxTokens 32000`, `maxToolCalls 15`, `timeoutMs 120000`, `execPreset: readonly` |

## Core defaults

- Loop: `maxIterations 15`, `timeout 120000` ms
- Exec: `execSecurity deny`, `execApprovalMode auto`; network is off by default; `network.enabled: true` allows HTTPS egress (`network.allowedDomains` limits domains; with `enabled` unset, `execPreset: network` still enables it); turns without network authority are not offered web_fetch / web_search
- Sub-agents: `subagentTurnMode off`
- Tool budget: `extendBy 10`, `progressWindow 5`, `maxTotalIterations 40`, `maxWallClockMs 600000`, `failureStreakLimit 3`, `repeatLimit 2`
- Usage quota: all 0 (off), `exemptOwner true`
- Dangerous-tool hard gate: always on; funds tools disabled (`allowFunds false`); a call not approved within 5 minutes (`approvalTimeoutMs 300000`) is denied
- Compaction: `thresholdRatio 0.7`
- Request traces: `recordRequestBodies true` stores redacted model-input text and tool definitions locally on the Host. Defaults retain at most seven days and 64 MiB in total. Capacity cleanup removes the oldest traces first; an oversized body leaves statistics and an explicit unavailable-body status. Set this to `false` to stop recording new bodies without disabling usage statistics or deleting existing records.

## Dangerous-tool hard gate

`execApprovalMode` decides who answers an ordinary approval (`ask` asks a person, `auto` lets the reviewer Agent decide, `bypass` skips it). The dangerous-tool hard gate is a separate gate, independent of it, and **cannot be turned off** (ADR 0036 §3):

| | `execApprovalMode` approval | Dangerous-tool hard gate |
| --- | --- | --- |
| Which tools | Tools whose `requiresApproval` asks for approval; shell / file policy | Tools that declare `risk: 'dangerous'`, the core list, `toolHardGate.dangerousTools` |
| Who can allow it | A person, the reviewer Agent, or `bypass`; "allow for this session / always" is possible | Only a fresh human approval of this call, or a card approved in the Console for the same arguments; `bypass`, the reviewer, the owner role and remembered grants do not count |
| After a denial | The model gets the denial | The call does not run (fail closed); the model only hears "refused, needs human approval, do not retry"; later calls to the same tool or the same dangerous category in this turn are refused without asking again |
| Unattended turns | Denied by policy | Denied, and a Console approval card is created; once approved, the next call **in the same session with the same arguments** runs once |

The core list is dangerous by category: member governance (kick, mute, set admins, roles, invite), content publishing (group announcements, channel posts, essence / pinned messages, Bilibili comments), funds (red packets, transfers, payments — **disabled by default**; with `allowFunds: true` they still need approval), and identity (bot profile, avatar, signature, unbinding accounts).

One more category is judged by **the target of the call**, not the tool name: **changing the host itself**, in two tiers. Paths are matched after realpath, `../` collapsing and case folding. **Denied outright (no approval card):** `node_modules/**` (any depth), lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock(b)`, `npm-shrinkwrap.json`), the file `ZHIN_PLUGIN_LIFECYCLE_FILE` points at, and what the file policy already refuses (`.env*`, `.zhin/`, root `data/`, `config.json`, `.npmrc`); no role can write them. **`self` hard gate:** writing, under the **project root**, the root config (`zhin.config.*`, `config.yml|yaml`), `package.json`, `schema.json`, the root plugin entry (`package.json#zhin.entry`), `AGENTS.md`, `skills/`, `.agents/skills/`, `.git/`, `.pnpmfile.cjs` or `assistant.profile.yml`. Only the project root matches, so a nested `plugins/x/package.json` is unaffected, and `pnpm-workspace.yaml` / `tsconfig*.json` are not managed in this phase. The host injects the project root and the root plugin entry; without an injection the gate matches those names at any depth (over-blocking rather than gating nothing). A `bash` command that writes one of these paths (redirection, `tee`, `rm`/`cp`/`mv`, …) gets the same two tiers, and adding, removing or updating dependencies with `pnpm` / `npm` / `yarn` / `bun` counts as `self`. A `self` write can loosen the hard gate, change the code the host runs or trigger a restart, so like every other dangerous category it needs a fresh human approval each time; bypass, the auto reviewer, owner exemption, `danger-full-access` and remembered approvals never grant it. Read-only queries (member lists, group info) are not gated and are still audited.

**Read-only mounts for the isolated shell (#1030 P0-c).** The string detection of `bash` commands above is only the first line (it gives friendlier errors); the enforcement is the mount. When the isolated container mounts the working directory as `workspace-write`, the **existing** paths of the two tiers above are overlaid as read-only bind mounts (`--mount type=bind,...,readonly`), so `sed -i`, writing through a symlink, `mv` and `rm -rf node_modules` all fail (`Read-only file system` / `Device or resource busy`), whatever the filesystem access level. Covered inside the mounted directory: the root config, `package.json`, `schema.json`, the plugin entry, `AGENTS.md`, `skills/`, `.agents/skills/`, `.git/`, `.pnpmfile.*`, `assistant.profile.*`, lockfiles, `ZHIN_PLUGIN_LIFECYCLE_FILE`, `.env*`, `.zhin/`, `.npmrc`, the children of `data/` other than `memory`/`media`, and `node_modules` directories up to **4 levels deep, at most 64** (the scan never enters `node_modules`, `.git` or symlinks). Missing directories (e.g. `skills/`, `node_modules`) get a read-only tmpfs so they cannot be created; Docker briefly creates an empty mount point on the host, removed after the run if still empty. **Missing files get no placeholder:** Docker would leave an empty file on the host, and an empty `zhin.config.*` / lockfile / `.pnpmfile.cjs` is more dangerous to hot reload and package managers than the gap, so creating a protected file that does not exist yet is still stopped only by the string detection. Without host-injected paths the conventional names are resolved against the mounted directory itself (over-blocking). **Residual risk:** `danger-full-access` (`isolation: none`) has no container, so nothing can be mounted and only the string detection remains; indirect writes (scripts, `python -c`, git hooks) may get past it. A symlink that points at a protected file can itself be replaced (its target stays read-only). Use the isolated shell when a hard guarantee matters, not `danger-full-access`.

**Self-change staging area (ADR 0040 §6a, slice A).** The host stages agent-drafted changes in `.zhin/changes/<id>/` (`change.json` metadata + `files/` drafts + `snapshot/` rollback copies); the directory is on P0 list A, so neither the agent's file tools nor its shell can write it. Writable targets are only the plugin convention directories (`commands/`, `middlewares/`, `handlers/`, `tools/`, `components/`, `skills/`, `agents/`), the root `AGENTS.md` and `skills/**`; the root config can only be changed through a field-level `configPatch`, and a patch that touches `ai.agent.toolHardGate*`, `ai.agent.execApprovalMode` or `ai.agent.masterShell` (including overwriting an ancestor) is refused outright. Disk use is bounded: on entering a terminal state (`applied` / `rolled_back` / `rejected` / `expired` / `trial_failed`) `files/` and `snapshot/` are deleted at once and only `change.json` stays, and the whole directory is removed after 14 days; `draft` / `ready` / `pending` changes idle for 24 hours become `expired`; a `failed` change (emergency stop) keeps its files until a person marks it handled. One change holds at most 5 MB / 50 files and the whole area at most 50 MB; over the limit a draft is refused before anything is written (`change_quota_exceeded`). Pruning runs at start-up and then every 6 hours, deletes only directories inside the staging area and never follows symlinks. State changes are written to `ai_decision_events` with `kind=self_change`; payloads carry paths and digests only, never file contents or config values.

**Drafting a change: `change_draft` (ADR 0040 §2, slice B).** When a user asks to "add a command / change a setting", the agent calls `change_draft` (`risk: safe`) with complete file contents and an optional field-level `config_patch` (values go in `value_json` as a JSON string); the host validates and stages it — **production is not touched and nothing takes effect**. It works only in IM conversations and can only revise the caller's own `draft` (`change_id`); editing a draft discards its old preview. The host then builds a preview and stores it as `plan` in `change.json`: create / modify / delete per file with added and removed line counts (line-based, moved lines not counted); the impact comes from the same `InvalidationPlanner` used for development file watching (over the current generation's source ownership) — `none`, `generation` (the plugin subtrees and capability slots that will hot reload) or `process` (restart required); a config patch is merged in the same way Console `config:patch` judges it — host sections (`http`, `database`, `ai`, …) need a restart, plugin sections hot reload that plugin. Without the ownership index the preview is a conservative estimate (files → hot reload, config → restart) and is marked as estimated. A preview is at most 64 KB and counts toward the staging quota. Trial runs and approval come in later slices.

```yaml
ai:
  agent:
    toolHardGate:
      dangerousTools: [my_plugin__wipe_album]  # add only; core tools cannot be lowered
      allowFunds: false
      approvalTimeoutMs: 300000                # denied on timeout
```

Approval cards are served by the Console RPC `plugin.root.tool-approvals` (read, permission `tool_approvals:read` or `ops:approve`) and `plugin.root.resolve-tool-approval` (`{ id, decision: 'approve' | 'deny' }`, permission `ops:approve` or the older `tool_approvals:resolve`, either one is enough); the full token can call both. Group-ops cooldown (ADR 0037 §3): one approval card per `platform + scene_id + tool local name` within `ops.cooldownMs` (default 60 seconds, set in session ops); during the cooldown the call is refused without a new card (`ops_cooldown` / `ops_cooldown_hit`). Every decision is written to `ai_decision_events`: `tool_approval` (`tool_approval_requested` / `tool_approval_approved` / `tool_approval_denied` / `tool_approval_timeout`) `tool_hard_gate` (allow: `tool_approval_approved`; deny: `tool_dangerous_no_approval`, `tool_approval_denied`, `tool_approval_timeout`, `tool_funds_disabled`, `tool_hard_gate_latched`), and `tool_call` (allow, `tool_safe_allowed`) for safe / read-only tools, which run but are still audited. An audit write failure never changes the decision.

### IM approval channel (#1013, off by default)

On-call approvers can settle hard-gate cards from IM instead of the Console. The channel shares the Console approval queue: whichever answers first wins and the other sees the card as decided. It still only accepts a human, settles one call per answer, and fails closed.

```yaml
ai:
  agent:
    toolHardGate:
      imApproval:
        enabled: true
        approverIds:            # a flat list applies to every platform; or map platform -> user ids
          icqq: ['10001']
        delivery: dm            # dm (default) messages approvers privately; approver_group posts to approverGroupId
        # approverGroupId: '123456'   # required for approver_group; must not be a business group
```

- Each new card (a reused same-argument card is not re-sent) goes out through the Endpoint that saw the call, privately to every approver of that platform, with the tool, category, conversation, a redacted argument preview, the card id and its expiry.
- Approvers reply `/approve <card id>` or `/deny <card id>` in the private chat (the prefix follows your command prefix). Only allowlisted users count; messages in groups or channels never settle a card (in `approver_group` mode only the configured approver group does), the conversation that triggered the call can never settle its own card, and saying "approve" in a business group does nothing.
- An approval runs exactly one call with the same session and arguments (the existing `consumeApproved` fingerprint); there is no session-wide or permanent grant. The channel is a Host command, not a model-callable tool, so neither `bypass` nor the reviewer Agent can reach it.
- When a card cannot be delivered (channel off, no approvers for the platform, `approver_group` without a group or pointing at the business conversation) or delivery fails, the card stays available in the Console and times out to a denial as usual; delivery is not retried. The queue lives in memory, so cards do not survive a restart.
- Audit: settlements in `tool_approval` record `payload.channel` (`console` / `im_dm` / `im_approver_group`, or `turn_prompt` for the in-turn prompt) and the operator in `actor_id`: `im:<platform>:<userId>` for IM, `console` for the Console for now. `payload.imApproval` on `tool_approval_requested` says whether the card could be delivered over IM.

## Switch inventory and disposition

Dispositions: **keep**, **preset** (advanced, use defaults), **merge-candidate**, **debug**, **internal** (code only), **deprecated**.

| Switch | Disposition | Notes |
| --- | --- | --- |
| `persona` | keep | Common switch, kept |
| `maxIterations` | keep | Common switch, kept |
| `timeout` | keep | Common switch, kept |
| `chatModel` | keep | Common switch, kept |
| `visionModel` | keep | Common switch, kept |
| `contextTokens` | keep | Common switch, kept |
| `execSecurity` | keep | Common switch, kept |
| `execPreset` | keep | Common switch, kept |
| `network` | keep | Dedicated network switch for IM turns (replaces getting egress via `execPreset: network`), kept |
| `execAllowlist` | keep | Common switch, kept |
| `execApprovalMode` | keep | Common switch, kept |
| `disabledTools` | keep | Common switch, kept |
| `allowedTools` | keep | Common switch, kept |
| `inboundQueue` | keep | Common switch, kept |
| `toolBudget` | keep | Common switch, kept |
| `injectionGuard` | keep | Common switch, kept |
| `toolHardGate` | keep | Dangerous-tool hard gate (ADR 0036); always on, can only be made stricter, see below |
| `usageQuota` | keep | Common switch, kept |
| `schedule` | keep | Common switch, kept |
| `masterShell` | keep | Common switch, kept |
| `compaction` | keep | Common switch, kept |
| `rateLimit` | keep | Common switch, kept |
| `preExecTimeout` | preset | Advanced tuning; defaults are recommended |
| `maxTools` | preset | Advanced tuning; defaults are recommended |
| `contextTailMessageLimit` | preset | Advanced tuning; defaults are recommended |
| `toneAwareness` | preset | Advanced tuning; defaults are recommended |
| `maxHistoryShare` | preset | Advanced tuning; defaults are recommended |
| `maxParallelSubagents` | preset | Advanced tuning; defaults are recommended |
| `toolExecution` | preset | Advanced tuning; defaults are recommended |
| `subagentAutoContinue` | preset | Advanced tuning; defaults are recommended |
| `subagentDirectImDelivery` | preset | Advanced tuning; defaults are recommended |
| `maxSubagentIterations` | preset | Advanced tuning; defaults are recommended |
| `subagentTurnMode` | preset | Advanced tuning; defaults are recommended |
| `subagentTools` | preset | Advanced tuning; defaults are recommended |
| `subagentTurnWaitMs` | preset | Advanced tuning; defaults are recommended |
| `modelSizeHint` | preset | Advanced tuning; defaults are recommended |
| `skillInstructionMaxChars` | preset | Advanced tuning; defaults are recommended |
| `modelHarness` | preset | Advanced tuning; defaults are recommended |
| `providerResilience` | preset | Advanced tuning; defaults are recommended |
| `providerTimers` | preset | Advanced tuning; defaults are recommended |
| `promptCache` | preset | Advanced tuning; defaults are recommended |
| `promptCacheRetention` | preset | Advanced tuning; defaults are recommended |
| `promptCacheKeyPrefix` | preset | Advanced tuning; defaults are recommended |
| `deferredTools` | preset | Advanced tuning; defaults are recommended |
| `workerBaseTools` | preset | Advanced tuning; defaults are recommended |
| `outputSchema` | preset | IM defaults to `segments`; [structured replies](./structured-replies.md). Explicit `false` keeps plain-text output. |
| `steeringMode` | preset | Advanced tuning; defaults are recommended |
| `followUpMode` | preset | Advanced tuning; defaults are recommended |
| `deferredAutoContinue` | preset | Advanced tuning; defaults are recommended |
| `deferredAutoContinueMaxDepth` | preset | Advanced tuning; defaults are recommended |
| `gitStatus` | preset | Advanced tuning; defaults are recommended |
| `contextPaths` | preset | Advanced tuning; defaults are recommended |
| `systemPromptMaxChars` | preset | Advanced tuning; defaults are recommended |
| `thinkingPreview` | preset | Advanced tuning; defaults are recommended |
| `thinkingPreviewMaxLength` | preset | Advanced tuning; defaults are recommended |
| `subagentExecApprovalMode` | merge-candidate | Future merge into per-role overrides of execApprovalMode |
| `workerExecApprovalMode` | merge-candidate | Future merge into per-role overrides of execApprovalMode |
| `phaseTrace` | debug | Diagnostics only |
| `promptTrace` | debug | Diagnostics only |
| `promptTraceVerbose` | debug | Diagnostics only |
| `recordRequestBodies` | keep | Records redacted request bodies locally by default; false disables new body retention while preserving usage statistics |
| `onPhaseTrace` | internal | Code-only callback, not YAML-configurable |
| `maxSkills` | deprecated | Unused at runtime; deprecated (#735), removed by --fix |
| `policyDenialStopAfter` | deprecated | Unused at runtime; deprecated (#735), removed by --fix |
| `deferredToolMaxResults` | deprecated | Unused at runtime; deprecated (#735), removed by --fix |
| `taskExecApprovalMode` | deprecated | Unused at runtime; deprecated (#735), removed by --fix |

## Deprecation path and compatibility

1. Deprecated keys are still accepted and never block startup;
2. A warning is logged once per deprecated key at startup;
3. `zhin config check` reports `ai.agent_<key>_deprecated`;
4. `zhin config check --fix` removes them;
5. Types keep them for at least one minor release before removal.

## Gate for new switches

Every new `ai.agent.*` switch must be added to the table above and justified in the PR template. `pnpm check:agent-config-inventory` (part of `pnpm check:all`) verifies the inventory is complete and that the non-deprecated switch count does not exceed the baseline.
