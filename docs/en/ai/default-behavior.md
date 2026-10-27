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

## Dangerous-tool hard gate

`execApprovalMode` decides who answers an ordinary approval (`ask` asks a person, `auto` lets the reviewer Agent decide, `bypass` skips it). The dangerous-tool hard gate is a separate gate, independent of it, and **cannot be turned off** (ADR 0036 §3):

| | `execApprovalMode` approval | Dangerous-tool hard gate |
| --- | --- | --- |
| Which tools | Tools whose `requiresApproval` asks for approval; shell / file policy | Tools that declare `risk: 'dangerous'`, the core list, `toolHardGate.dangerousTools` |
| Who can allow it | A person, the reviewer Agent, or `bypass`; "allow for this session / always" is possible | Only a fresh human approval of this call, or a card approved in the Console for the same arguments; `bypass`, the reviewer, the owner role and remembered grants do not count |
| After a denial | The model gets the denial | The call does not run (fail closed); the model only hears "refused, needs human approval, do not retry"; later calls to the same tool or the same dangerous category in this turn are refused without asking again |
| Unattended turns | Denied by policy | Denied, and a Console approval card is created; once approved, the next call **in the same session with the same arguments** runs once |

The core list is dangerous by category: member governance (kick, mute, set admins, roles, invite), content publishing (group announcements, channel posts, essence / pinned messages, Bilibili comments), funds (red packets, transfers, payments — **disabled by default**; with `allowFunds: true` they still need approval), and identity (bot profile, avatar, signature, unbinding accounts). Read-only queries (member lists, group info) are not gated and are still audited.

```yaml
ai:
  agent:
    toolHardGate:
      dangerousTools: [my_plugin__wipe_album]  # add only; core tools cannot be lowered
      allowFunds: false
      approvalTimeoutMs: 300000                # denied on timeout
```

Approval cards are served by the Console RPC `plugin.root.tool-approvals` (read, permission `tool_approvals:read`) and `plugin.root.resolve-tool-approval` (`{ id, decision: 'approve' | 'deny' }`, permission `tool_approvals:resolve`); the full token can call both. Every decision is written to `ai_decision_events`: `tool_approval` (`tool_approval_requested` / `tool_approval_approved` / `tool_approval_denied` / `tool_approval_timeout`) and `tool_hard_gate` (`tool_dangerous_no_approval`, `tool_approval_denied`, `tool_approval_timeout`, `tool_funds_disabled`, `tool_hard_gate_latched`). An audit write failure never changes the decision.

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
