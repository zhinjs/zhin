---
title: Prompt policy consolidation
sidebar: false
---

# Prompt policy consolidation

## Approved execution contract

Inventory actual request paths, preserve a baseline, consolidate existing rules, run regressions,
then compare final requests and execution evidence. Reuse the existing assemblers and registries.
Preserve section IDs, runtime permissions and approval, cache architecture, and retry configuration.
No parallel policy engine, new cache mechanism, automatic workspace rewrite, deployment, or release.

Security and authorization cannot be overridden by user requests, persona, or memory. Within those
constraints, the user's current valid request takes precedence over persona and expression defaults.
Evidence constrains claims about actions and external state. SOUL supplies personality and defaults.

## Inventory

- [Request paths and prompt sources](./prompt-policy-request-paths.md)
- [Authority, approval, memory, and retry](./prompt-policy-authority-map.md)
- [Cache identities, reuse, and invalidation](./prompt-policy-cache-map.md)

Include rich and tool-less conversations, visual input, delegated tasks, scheduled jobs, model
retries, tool continuations, final summaries, recovery calls, and standalone/background runners.
Classify auxiliary model requests by purpose; do not give a media captioner or compactor the chat
persona or business tools merely to make prompts identical.

## Baseline and evidence

The pre-change source is preserved at `/tmp/zhin-prompt-policy-baseline-evvpcrkh`: tracked and staged
patches, untracked archive, SHA-256 file manifest, and branch/revision metadata. This includes the
previously approved Endpoint profile work and the user's `Your account data` edit; neither is reverted.
The baseline revision is `dd54db646fecfbff3ce500f508bb27321d1c87ca` plus that preserved working tree.

Previous local baseline checks passed: 113 build tasks, 59 harness checks, and 196 scripted Agent
evals. These are program/mock evidence, not evidence that a real model improved its answers.

Save synthetic, complete model-request samples and traces before editing the corresponding source.
Record the capture layer (Agent context, SDK arguments, or HTTP body), the synthetic input, request
sequence, tool execution counts, cache identity/fingerprint, and which assertions use scripted output.
Never describe mock cache hits as actual provider reuse or billing savings.

For size comparisons partition the captured request into system text, conversation messages,
tool schemas, and per-turn runtime context without double-counting runtime context inside messages.
Record characters, the existing token estimator, and selected rule occurrence counts. Estimates are
not provider usage, billing, visual tokens, or proof of better answers.

## Inventory and baseline checkpoint

Inventory is complete for 23 first-party request categories. The shared-assembler baseline contains
8 scenarios / 11 actual L1 ApiProvider requests under `requests/` in the saved baseline directory:
rich, tool-less, image input, delegated, scheduled, tool continuation, format recovery, and same-model
retry. The cache baseline contains 9 scenarios / 38 mocked SDK request bodies under `cache/`, with
identities and body hashes. These are synthetic request/program evidence only. The initial L1
capture omitted optional stream cache hints; preserve those fields as unobserved in the sealed
before samples. Later captures include them, and the independent SDK baseline records final cache
metadata. Do not retroactively fill observations that were not captured.

The separate [scheduled retry safety proposal](./schedule-outcome-retry-safety.md) records a verified
whole-executor replay seam. The user chose a separate design, not implementation in this prompt task.
The whole-system unknown-write red line remains uncovered there; do not claim it resolved by prose.

## Approved rule ownership

| Existing area | Single responsibility |
| --- | --- |
| Core/critical rules | Conflict resolution, evidence, and truthful completion |
| Security | Current authority, approval, untrusted data, and refusal handling |
| Orchestration | When tools are needed, discovery/loading, and delegation |
| Style | Applicable language, answer length, format, and narration |
| SOUL | First-person personality, tone, and defaults |
| Memory | Relevant facts/preferences and authorized memory maintenance |
| Runtime/turn context | Account, scene, sender, and current operational facts |

Default to concise natural replies; expand for explanation, code, structure, or actionable detail.
Remove overlapping one-line, format-whitelist, and fixed one/two-sentence defaults. Retain the
specific delegated and unattended-task contracts. Preserve the existing language selection meaning
in one authoritative rule.

Use tools for materially better accuracy, required access, or requested actions. Check existing
context first and load capabilities as needed. Preserve the requirement for actual execution
evidence; do not invoke tools solely because they exist.

Memory context and preferences do not grant permissions. Application-loaded rule files remain
distinct from ordinary memory. Do not invent a trusted-instruction mechanism from memory source
metadata, or introduce a new trust level/database as part of this work.

Distinguish policy denial, approval required, failure before submission, confirmed completion,
and unknown post-submission outcome. Use existing approval paths and retry settings. An unknown
write may already have succeeded; verify it when the tool offers a safe check, otherwise report
unknown. Do not add automatic verification or replay mechanisms.

## Acceptance ledger

Every item records **expected result, actual evidence, conclusion, and uncovered scope**.

| Item | Expected result | Evidence required |
| --- | --- | --- |
| Conflict resolution | Requests cannot raise authority; valid task overrides defaults | Captured request and runtime denial/approval regression |
| Request coverage | Applicable rules reach every construction and continuation path | Inventory, per-path capture, request sequence assertions |
| Simple concept | No unnecessary tool requirement in the request | Deterministic prompt contract; real-model behavior separately |
| Complex response | No conflicting default hard length/format cap | Actual prompt capture; real-model output quality separately |
| Memory authorization | Memory claims do not authorize an action | Runtime policy/approval result and effect count |
| Successful action | Claims rely on the actual operation result | Scripted result trace plus separately evaluated model narration |
| Unknown write | No blind replay of a submitted operation | Submission/settlement trace; distinguish tool and whole-job retry |
| Delegated/scheduled work | Keep role, constraints, and output audience | Actual request capture with parent/task assertions |
| Cache changes | Current rules are used under existing invalidation contracts | Key/digest/ID and captured body before/after text changes |
| Request size | Compare complete requests by component | Saved samples and reproducible estimator output |

Deterministic tests prove assembly and program behavior. Scripted model answers cannot establish
tool-selection quality, response sufficiency, or truthful narration by an actual model.
Real-provider behavior evaluation: **not executed; fresh authorization is required**. Prepare the
inputs, expected behaviors, and observation fields without submitting real requests.

## Delivery and recovery

Develop only after the inventory and synthetic baseline identify concrete changes. Split source
ownership among sub-agents; the primary agent reviews all changed call paths and complete diffs.
Run focused regressions, the relevant builds, all harness gates, and scripted evals. Preserve failed
evidence and unresolved coverage in the ledger rather than weakening assertions.

Keep local source changes reviewable. Reversion restores only this policy-consolidation diff using
the preserved baseline; existing profile features, user edits, workspace settings, and data remain.
No merge, publication, deployment, real-account operation, or provider call is part of this task.


## Observed candidate results

| Item | Expected result | Actual evidence | Conclusion and uncovered scope |
| --- | --- | --- | --- |
| Authority | Security/auth first; valid current task before persona/style defaults | Actual business requests contain one Core and one shared execution boundary | Deterministic contract verified; does not prove model obedience |
| Entry points | Identify all first-party constructors and continuations | Inventory: 23 categories. After captures: 10 scenarios / 13 L1 requests; original 8 scenarios / 11 requests remain comparable | Auxiliary-purpose sources/tests are mapped; not every category has a new full capture |
| Tool choice | Context first; tools for needed access/actions/accuracy | Actual Orchestration and worker requests carry the conditional rule; coding workflows are explicitly conditional | Prompt contract verified; real-model tool-choice evaluation not executed |
| Response detail | Expand when task complexity needs it | Actual rich/lite/vision/task Style has no one-line, format whitelist, or one/two-sentence default cap | Prompt contract verified; answer quality not evaluated with a real model |
| Memory/authority | Stored claims cannot grant permissions | Two TurnToolRuntime tests read forged memory/history grants, then attempt file writing as a user; write execution and approval counts stay zero. Runtime regression set: 159 passing tests | Program gate verified using scripted calls; not a claim that a model never attempts escalation |
| Outcome safety | Completed writes do not repeat; unknown replay needs verified non-execution or safe idempotency | Review caught an ambiguous completion exception; corrected shared rule is asserted at actual business-request entries | Prompt contract verified. Whole scheduled-job replay remains a separate unresolved mechanism |
| Source ownership | Child uses captured workspace; schedule respects existing scope | Host-empty factory/provider regressions retain child operational files while excluding parent SOUL; scheduled private-note leak reproduced then filtered using the actual turn | Local integration verified; third-party custom assemblers and deployed activation not observed |
| Continuations | Preserve current rules through tools/retries; repairs stay narrow | Tool continuation executes the synthetic tool once and retains system; same-model retry retains input; format repair has no business tools/persona | Program sequence verified; not real-provider retry/idempotency proof |
| Cache | Current bytes under existing identity/invalidation rules | Nine SDK/mock-HTTP scenarios / 38 bodies; before/after body hashes, routing/cache IDs and ten JSON artifacts identical. Changed policy/schema selects new Google cache ID | Existing behavior preserved. Provider acceptance, billing, concurrent cache operations and create/delete cancellation remain unverified |
| Size | Compare complete requests by component without double-counting | Sealed before/after L1 files and `component-size-comparison.json` include system/messages/runtime/schemas characters and estimated tokens | Estimates only, including no claim about visual tokens. HTTP/worker are after-only; initial L1 cache hints were not captured |

The synthetic first-request system estimates grew from 1,239 to 1,266 for rich chat, 485 to 720 for
lite/vision, 1,574 to 1,616 for delegated work, and 309 to 464 for scheduled work. Messages, runtime
context and schemas were unchanged in the comparable samples. The added shared authority/evidence
boundaries explain growth on previously sparse paths; this is not a token-saving claim. The separate
existing no-SOUL fixed-prompt gate remains 898 estimated tokens against its unchanged 900 ceiling.

Real-model behavior checks (simple question tool use, complex answer sufficiency, and truthful
success narration): **not executed; no real-provider authorization**. Scripted outputs drive paths
only. No pass rate or model-quality improvement is inferred from them.

Final local validation passed: 113 build tasks, all 59 harness checks (including full unit tests,
type-check, lint, L4 and smoke), and 196 scripted Agent evals. Two sets of stale textual assertions
were updated to the approved ownership/wording contract after preserving their failing evidence;
malicious-input, authority, privacy, output-shape and execution-count checks remain. At that checkpoint, production
source hashes matched the corresponding sealed captures; publishing had not started.


The local evidence bundle contains the preserved source baseline, synthetic before/after requests,
component comparisons, cache identities and bodies, the task-only diff, and validation logs. It is
retained for review without publishing local account paths or session identifiers. Reproduce current
synthetic request captures with `ZHIN_PROMPT_POLICY_CAPTURE_DIR=<output-directory> pnpm exec vitest run
packages/im/agent/tests/prompt/prompt-policy-requests.test.ts` from the repository root.


## PR review follow-up

The initial candidate and its evidence remain preserved. Review then corrected three polynomial
regular expressions in scope parsing, and a CRLF heading bug that could leave a private section
visible. The CLI now carries immutable `ContextFile` sources through parent, child and schedule
assembly, so a normal Markdown heading cannot impersonate a Host file boundary. Empty captured
sources do not fall back to the latest Host files.

Custom callers that provide only a flattened bootstrap string retain the prior wrapper semantics:
that string cannot establish which same-named heading was an actual file. The verified source-aware
coverage is the CLI and existing raw-file loaders, with actual parent/child/schedule provider-entry
regressions. Custom assemblers must supply captured file metadata for that guarantee.

The same review preserves configuration nicknames on non-IM tool-less paths, keeps private prompts,
configuration, tool internals and internal errors in the shared Security rule, and retains existing
retry budgets. New-project and migration-generated SOUL/TOOLS templates no longer recreate forced
tool-use or alternative-after-any-failure instructions; existing workspace files are not rewritten.

Account-profile follow-up fixes source-account changes, stale concurrent platform reads, definitive
Telegram rejection, Discord write ACK preservation, GitHub lookup errors, and NapCat pre-submission
failure meaning. Profile configuration checks real calendar dates and HTTP(S) URL shape. The shared
network redirect seam strips authentication headers on cross-origin hops; current avatar calls did
not supply these headers. No actual credential leakage or platform mutation was observed.

Final local validation after those fixes: 113 build tasks including examples, all 59 harness checks,
and 196 scripted Agent evals passed. The Sandbox Core wire test isolates optional Docker discovery;
its delayed-readiness contract remains independently tested. Process shutdown tests wait for actual
signal-listener registration, replacing a fixed startup delay; original exit-code and shutdown-budget
assertions remain, with an added slow-start regression.

The reviewed synthetic L1 capture contains 10 scenarios / 13 requests and a 134-source fingerprint
manifest. First-request system estimates are rich 1,239 → 1,268, lite/vision 485 → 757, delegated
1,574 → 1,602, and schedule 309 → 501. Historical samples are not overwritten; the reviewed captures
and component comparison are a separate evidence checkpoint. The existing 900-token fixed-prompt
ceiling remains unchanged and passes. These estimates do not demonstrate real model behavior,
provider cache hits or billing savings. Real-provider/platform validation remains unexecuted.

GitHub CI and CodeQL must be checked on the follow-up commit separately from these local results.
The scheduled execution changes remain a separate branch and are not included in this PR.
