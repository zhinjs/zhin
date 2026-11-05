> Historical baseline inventory. Removed runtime links are pinned to the pre-change commit; the target Provider runtime is documented in [model services](../ai/providers.md).

---
title: Prompt policy cache map
sidebar: false
---

# Prompt policy cache map

Status: read-only source inventory of the current worktree, including its uncommitted changes.
This document adds no cache, invalidation rule, provider call, retention policy or production change.
The test inventory below records inspected assertions; the separately listed baseline was executed.
Mocked responses are not evidence of real provider cache hits, provider retention or billing discounts.

## Findings and evidence boundary

The code contains three different mechanisms that must not share the label “cached prompt”:

1. Application state: reusable SDK clients, projected context references, history-window anchors,
   per-loop token estimates and pending local-image inputs. These save local work or input bytes;
   none is a model-answer cache.
2. Explicit upstream resources: Google's opt-in `cachedContents` wrapper stores a resource name
   for a hash of the current stable prefix. Reusing a name omits that prefix from the generation
   request; this is the only audited path that creates and deletes upstream cache resources.
3. Provider prefix caching: OpenAI routing hints and Anthropic breakpoints describe the current
   input. Implicit provider caching and its billing remain provider behavior, not an application
   cache lookup. A stable routing key is not a content fingerprint or proof of a cache hit.

**Conclusion:** an old SDK instance or an unchanged OpenAI routing key does not demonstrate stale
prompt content. The actual assembled system text, current tools, projected messages and (for
Google explicit mode) the prefix hash must be compared. A deliberately captured prompt reused
within one Agent loop is a separate lifecycle question, not evidence that a provider replayed an
obsolete cache.

## Request paths and ownership

| Entry | Current path | Reused state | Update boundary |
| --- | --- | --- | --- |
| IM/full Agent | `FullAgentTurnEngine` → `agent-core-run` → `agentLoop` → completion port → `LlmApiRuntime` → AI SDK bridge | Host context repository, Host history tracker, registered LanguageModel; loop captures system/tools | A new turn assembles its current prompt. Tool disclosure rebuilds the loop tool array; context compaction/windowing reprojects messages. |
| Standalone Agent loop | `runAgentLoopStandaloneTurn` → isolated memory repository → `agentLoop` → supplied or newly created `LlmApiRuntime` | Supplied runtime may outlive the loop; repository and deferred-tool fork belong to this loop | Every standalone run starts its own conversation. Its supplied system string remains fixed during that loop; disclosure changes its tools. |
| Lightweight completion | `SdkProviderAdapter.completeTextResult` → resilient port → `generateTextViaAiSdk` | Adapter's private `#textRuntime` and its per-model LanguageModel | Each call constructs a new `system + user` Context; the transport wrapper is reused. |

Evidence: [full engine](../../packages/im/agent/src/plugin-runtime/full-agent-turn-engine.ts),
[main loop assembly](../../packages/im/agent/src/core/agent-core-run.ts),
`standalone runner`（已在 ADR 0048 H2 删除）,
[lightweight provider](https://github.com/zhinjs/zhin/blob/d8532ddbf8194dd422818463deb554bb97d587e7/packages/im/ai/src/sdk-provider-adapter.ts),
[LLM runtime](../../packages/im/ai/src/llm/llm-api-runtime.ts).

`LlmApiRuntime.#languageModels` uses `alias::modelId`. Registering a provider clears that alias's
LanguageModels; explicit `registerLanguageModel` replaces one entry. Model objects do not store
the system prompt. SDK construction attaches the Google explicit-cache wrapper to that instance.
An Adapter's lightweight `#textRuntime` therefore retains successful cache IDs and creation
backoff across `completeTextResult` calls, while different Adapter instances remain independent.
The main Agent runtime and this lightweight runtime can be separate owners even for the same alias.

The model-catalog resource layer additionally keys execution resources by
`[ownerId, connectionId, revision]`, with a definition fingerprint of
`[ownerId, id, revision, sdk, baseUrl, secretRef]`. It rejects conflicting definitions at one
revision and retires older resources when a newer revision is acquired. This is connection
resource reuse, not prompt-content reuse. Evidence:
[model leases](https://github.com/zhinjs/zhin/blob/d8532ddbf8194dd422818463deb554bb97d587e7/packages/im/ai/src/model-catalog/runtime.ts).

## Deployment and file-loading boundaries

“The file changed” and “the next request assembled new text” are different observations. These
loading paths have different owners and must not be treated as one provider-cache invalidation rule.

| Input | Read / capture point | When a change can affect requests |
| --- | --- | --- |
| CLI Host `SOUL.md`, root `AGENTS.md`, `TOOLS.md` | `installAgentHost` calls its local `loadBootstrap(projectRoot)` during Agent Host installation. `AgentHostPublicationCoordinator` passes that resulting string into the created `FullAgentTurnEngine`. | When the Host/engine receives a newly loaded bootstrap snapshot through its existing installation/replacement path. This is not a disk read on every turn, and not proof that every unrelated generation reload replaces that Host. |
| Library Host bootstrap | `configureZhinAgent` assigns the caller-provided bootstrap; `ZhinAgent.bootstrapContext` resolves a captured turn configuration first, otherwise its configured value. | Caller-supplied reconfiguration/new turn scope can supply new text; no file watcher is established by that setter. A Full engine's explicit bootstrap option can take precedence over the Host property. |
| Nearer workspace `AGENTS.md` | `ContextSystem.buildTextTurnContext` calls `buildAgentsEnvelopeContext`, which reads the instruction chain. It excludes a root `AGENTS.md` already represented by the captured system bootstrap. | A subsequent context-preparation pass can see nearer-file changes. The excluded root remains subject to its Host bootstrap lifetime rather than silently being reread as a second authority. |
| `prompts/{orchestrator,deferred-worker,compaction}[.{sdk}].md` | `resolveWorkspacePrompt` reads synchronously on each call, checking workspace first and then package fallback files. Orchestrator resolves during rich prompt assembly, worker during worker assembly, compaction when that transform assembles its prompt. | The next resolution call can see a changed file. An already assembled main/worker loop does not reread its system prompt on each provider retry or tool step. A compaction prompt may be resolved later than the main loop prompt. |
| Compiled package prompt constants | Node imports the actual deployed module; the selected constants are combined when the assembler runs. | The deployed process must actually load the new built module (normally install/build plus the applicable runtime/process reload). Editing TypeScript source, publishing a version, or replacing an unrelated plugin alone does not establish that a long-lived Host's imported module changed. |

Evidence: [Host installation](../../basic/cli/src/plugin-runtime/agent/host-installer.ts),
[publication](../../basic/cli/src/plugin-runtime/agent/publication-coordinator.ts),
[Host configuration](../../packages/im/agent/src/init/configure-zhin-agent.ts),
[turn configuration](../../packages/im/agent/src/turn/agent-turn-context.ts),
[context preparation](../../packages/im/agent/src/context/context-system.ts),
[instruction reads](../../packages/im/agent/src/context/agents-instruction.ts),
[workspace overrides](../../packages/im/agent/src/prompt/workspace-prompt.ts),
`worker assembly`（已在 ADR 0048 H2 删除）,
[compaction assembly](../../packages/im/agent/src/memory/compaction-runtime.ts).

**Conclusion:** an in-flight generation/turn continuing with its already captured bootstrap/system
prompt is expected snapshot behavior. A Host that has not reloaded its bootstrap can legitimately
produce the previous bytes and reuse that prefix. Neither case proves that an upstream cache
substituted an old prompt for new content. No claim is made that editing a disk file immediately
updates every in-flight request, and this inventory adds no watcher or refresh mechanism.

Delegated children now receive the engine's captured bootstrap explicitly through their options
and `promptRuntime`, rather than relying on the mutable Host property (empty in the CLI factory).
Their final delegated assembler excludes the parent's SOUL while retaining applicable operational
AGENTS/TOOLS sections under the existing scene filter. This fixes missing inherited workspace
instructions; it neither refreshes the admitted generation nor alters provider cache behavior.

**Acceptance still missing:** mutate a synthetic bootstrap on disk, show that the existing engine
retains its captured text, exercise the actual authorized Host replacement path, then show a new
turn sees the new text while an admitted old turn retains its own snapshot. Separately verify the
next workspace-override resolution versus a running loop, and verify which deployed compiled
artifact/version is actually loaded. Current fixed-input SDK baselines test content invalidation
once changed text reaches the transport; they do not test deployment or file-reload activation.

## Google explicit cache: exact identity and lifecycle

Expected contract: only a byte-identical stable prefix reuses an upstream resource; changed
messages do not require recreating a cache containing only system/tools. Source evidence:
[cache wrapper](../../packages/im/ai/src/llm/gemini-context-cache.ts),
[SDK construction](../../packages/im/ai/src/llm/sdk-registry.ts),
[system splitting](../../packages/im/ai/src/llm/bridge/ai-sdk-prompt-cache.ts).

| Property | Current implementation |
| --- | --- |
| Activation | Only SDK construction with `contextCache.mode === 'explicit'` installs the wrapper. Normal/implicit mode leaves requests unmodified. The generic stream `promptCache` switch controls bridge hints, not this independently configured fetch wrapper. |
| Admission | Matches `models/{model}:generateContent` or `streamGenerateContent`, requires a string JSON body, skips requests already containing `cachedContent`. |
| Hashed content | `SHA256(model + NUL + JSON.stringify(prefix))`, where prefix contains present `systemInstruction`, `tools`, `toolConfig` in that fixed field order. Nested JSON property/array order remains significant. |
| Split system | When the SDK body has more than one system part, the last part is treated as the scene tail. The preceding parts form the cached system prefix. That tail is prepended to `contents` when using a cache ID. |
| Not in content hash | Conversation messages/`contents`, temperature, output cap, generation configuration, sender/session IDs unless present in the prefix itself. Base URL and credentials are not in this hash: their ownership is the enclosing registered SDK instance. |
| Resource ID | Successful create response's `name`, e.g. `cachedContents/...`; kept only in the wrapper's in-memory `entries`. The application does not generate that ID. |
| Reuse | Same hash and local `expiresAt - now > 30,000 ms`; `stats.reused` counts selection of a cached name, not provider-confirmed cached tokens. |
| Local lifetime | Requested TTL is `max(60, configured ttlSeconds or 600)` seconds. A prefix under `minPrefixChars` (default 8,000 JSON characters) bypasses explicit creation. This is not an exact token minimum. |
| Prefix update | One `currentKeyByModel` per wrapper. A different accepted prefix for that model removes the previous local entry, attempts its remote DELETE, then resolves/creates the new prefix. Returning A → B → A creates A again rather than retaining both. |
| Expiry | Within the 30-second margin, another create replaces the local entry. Expiration is calculated from local create completion and requested TTL; the response's expiry metadata is not consulted. |
| Create failure | Falls back to the unchanged generation request. A nameless entry backs off by the local TTL, subject to the same 30-second validity test. HTTP 403/404, or selected unsupported-model HTTP 400 errors, mark that model unsupported for the wrapper lifetime. |
| Cache-use failure | Generation HTTP 400/403/404 removes entries with that name and sends the original full request once. This is a separate fetch-level fallback, not the general resilience retry loop. |
| Process/resource replacement | A new LanguageModel gets a fresh wrapper. No cache index is persisted. The wrapper has no disposal/delete-all hook; remote resources still have their requested TTL. |

**Conclusion:** current sequential changed-prefix logic selects a new hash; a stable ID is not
used with a changed hashed prefix. Creating a cache does not prove that a gateway stores or bills
it like Google's native API. In particular, implicit-cache usage does not establish support for
explicit cache CRUD on an Antigravity gateway.

**Uncovered source risks to verify, without changing behavior here:**

- Concurrent same-prefix calls have no in-flight-create coalescing; concurrent different prefixes
  can race the model's single-current-key/delete policy. Existing sequential tests do not establish
  request ordering, remote deletion safety or the number of created resources in these cases.
- Create and delete requests do not carry the original generation request's `AbortSignal`; only
  the subsequent generation uses its original `RequestInit`. No inspected cache test covers
  cancellation during create/delete or wrapper replacement during an outstanding create.
- The local stats are attempts/ID reuse, not confirmed deletion or server-hit counters. DELETE
  increments the count before the fetch and ignores its outcome.
- Negative backoff is checked with the same 30-second margin as successful entries, so “one TTL”
  comments are not an exact promise of the earliest retry time. Near-expiry old resources are not
  explicitly deleted by the renewal path. These are current facts, not a proposed new TTL policy.

## OpenAI, compatible gateways and Anthropic

Evidence: [bridge cache options](../../packages/im/ai/src/llm/bridge/ai-sdk-prompt-cache.ts),
[stream/nonstream bridge](../../packages/im/ai/src/llm/bridge/ai-sdk-stream.ts),
[Agent defaults and key builder](../../packages/im/agent/src/config/zhin-agent-runtime.ts),
[wire tool ordering](../../packages/im/ai/src/llm/bridge/ai-sdk-messages.ts).

| Mechanism | Key / boundary | What changes and what is reused |
| --- | --- | --- |
| Agent OpenAI routing key | Sanitized `{prefix}:{label}:{provider}:{modelId}`; non `[A-Za-z0-9._-]` characters become `_`. Prefix defaults `zhin`; main loop labels are `orchestrator` / `chat`. | No session ID or prompt digest. Same key routes potentially matching current prefixes; it does not replace request content. Prompt changes continue to be sent. Sanitization collisions are possible routing collisions, not evidence of semantic answer reuse. |
| OpenAI SDK | `providerOptions.openai.promptCacheKey`, optional `promptCacheRetention` | Sends the current system/messages/tools. No local cache-content store or create/delete endpoint in this bridge. |
| `openai-compatible` | Same raw body keys only when `compat.promptCacheKey === true` | Default omits extra routing fields for strict gateways. Actual caching/field support is gateway-specific. |
| Anthropic system | Ephemeral marker on stable system block if split, otherwise whole system | Scene block has no system marker. Changing stable system bytes changes the prefix; markers do not keep old text. |
| Anthropic tools | Ephemeral marker on the last tool after name sorting | Same tool set is order-stable despite recency order changes. Added/removed/schema/description/defer-state changes can alter the prefix. Necessary tool schemas are not replaced by prose. |
| Anthropic messages | Mark current cacheable input and the cacheable input before the latest assistant response | Recomputed from the current projected serial history. Reasoning-only/empty tail is skipped. If a current user message has a runtime-context marker, the first body text part is anchored before that tail. At most two message markers plus system and tools. |

Agent option construction only enables bridge caching for Anthropic/OpenAI/compatible SDKs;
explicit `promptCache: false` or the disabling environment flag turns these hints off. At the
low-level stream bridge, unspecified `promptCache` is enabled. Google splitting is independent
of that boolean so its configured explicit wrapper can still separate stable/scene parts.
Standalone-loop options are supplied by its caller; lightweight text completion supplies no
OpenAI routing key in its call to the bridge. This does not disable a provider's implicit caching.

**Conclusion:** repeated OpenAI keys and Anthropic ephemeral markers are not application request
fingerprints. The real request still includes the current text and tools (apart from Google's
explicit `cachedContent` substitution). Provider discounts, minimum token lengths and eviction
cannot be established from these options alone.

## Prompt references, budget memoization and history windows

| Application mechanism | Identity / update / reuse | Evidence and limits |
| --- | --- | --- |
| PromptContext references | `contextRef.key` plus SHA-256 of the complete labelled text. A fresh `seen` map is built for each projection; identical trusted blocks are omitted, changed bodies including A → B → A remain. Structured state can render field deltas. | [projection](../../packages/im/ai/src/memory/prompt-context.ts). Modified metadata/digest, failed tools, unmarked user text and assistant text cannot establish reusable guidance. Not a process-wide cache of prompt text. |
| Scope-specific memory reference | `file-memory:SHA256(JSON.stringify([cwd, sessionKey, subjectId, platform, endpoint, scope, sceneId, canonical endpoint/conversation/parent/thread fields]))`, plus the content digest above | [turn envelope](../../packages/im/agent/src/context/turn-envelope.ts). Each turn reads its memory snapshot; a stable scope key does not suppress a changed body. |
| Active Skill references | `skill:{qualifiedName}` plus current instruction digest | [Skill context](../../packages/im/agent/src/context/skill-context.ts), [deferred plan](../../packages/im/agent/src/plugin-runtime/deferred-capability-plan.ts). Tool-result and injected Skill blocks can share provenance and be deduplicated by projection; source-level occurrence counts alone overstate actual request duplication. |
| Main loop fixed budget | Closure-local Promise; reuse only while `budgetTools === llmTools`. System/model/output-schema are fixed by the same loop closure. A replacement tool array recomputes it. | [main loop](../../packages/im/agent/src/core/agent-core-run.ts), [budget calculator](../../packages/im/ai/src/compaction/context-budget.ts). Counts current converted JSON Schema and output schema, not a provider request or provider bill. In-place tool mutation is not an invalidation key; standard disclosure replaces the array. |
| History-window start | Host-owned tracker via WeakMap; per-session anchor `role:timestamp:messageId-or-toolCallId` | [window tracker](../../packages/im/agent/src/context/history-window.ts). Retains the start while projected history fits. On overflow advances at turn boundaries, normally to 75% fill; missing anchors refill from newest history. Restart/new Host loses anchors, not stored conversation. |
| Request-local private image projection | Pending authenticated asset references; dedup by `asset_id` only while preparing one completion | [image inspection](../../packages/im/agent/src/media/local-image-inspection.ts). Each accepted inspection still consumes its admission budget. Original bytes are read with the scope and injected only for the request; successful completion consumes the pending list. Distinct assets with identical bytes remain distinct. No persistent visual answer cache. |

Current history defaults are 8,000 group/channel, 12,000 private and 24,000 master-private
estimated tokens. A configured zero disables the token bound; the optional message cap is
independent. The summary head and oversized current turn are preserved. The tracker measures
projected input, subtracts current-turn input, and never deletes stored history. The Agent loop
uses full retained messages for compaction and applies the window again at the provider boundary.
Compaction/branch cuts naturally change the provider prefix; that is not stale content reuse.

Text tokens use weighted CJK/other-character estimates, and image/audio/video/file blocks use
existing coarse media budgets rather than base64 length. Provider/cache billing tokens cannot be
derived from these estimates. Evidence:
[text estimator](../../packages/im/ai/src/compaction/token-counter.ts),
[media/message estimates](../../packages/im/ai/src/compaction/agent-message-tokens.ts).

The current-message layout keeps owned sender header, body, quote and participant media before
the runtime-context tail. Old runtime tails are stripped from model history; storage keeps the
conversation rather than current-turn guidance. Quotes and original media are therefore part of
the actual prefix comparison; they cannot be replaced with a text-only cache estimate. A repeated
private `get_local_assets` payload is a different request-local mechanism from participant image
history. Evidence: [message construction](../../packages/im/agent/src/context/turn-user-message.ts),
[provider projection](../../packages/im/ai/src/memory/event-rendering.ts),
[SDK message conversion](../../packages/im/ai/src/llm/bridge/ai-sdk-messages.ts).

## Continuation, retry and observation identity

`agentLoop` retains its captured `initialContext.systemPrompt` and cache-breakpoint offset across
iterations and follow-up recursion. Every completion rebuilds repaired/projected messages; tool
changes are carried by the loop's current tool list. A new turn assembles a new prompt, while an
already-running turn is not shown re-reading workspace policy files here. That capture boundary
must be considered separately if the policy task requires changes to take effect mid-run.

The resilient completion port forwards the same Context and stream options on ordinary attempts,
changing the AbortSignal and setting SDK `maxRetries: 0` so retries do not multiply. It does not
memoize answers. A context-overflow recovery can compact messages and retry only after an actual
estimated reduction. A follow-up/new tool result can change message bytes without changing the
stable system/tools prefix. A provider/model switch is an explicit caller/runtime decision, not a
cache invalidation action. Evidence: [loop](../../packages/im/ai/src/llm/agent-loop.ts),
[resilience](../../packages/im/ai/src/llm/provider-resilience.ts).

The tracing request ID is a random UUID for one semantic completion attempt. SDK-internal retries
may observe the same semantic input more than once; framework attempts get separate IDs.
`onRequest` captures SDK-prepared system/messages/tools/output-schema with media omitted. It is
not a complete HTTP-body fingerprint, nor proof of network receipt. No audited cache path uses
this trace ID or observation as a response-reuse key. Evidence:
[usage/requests](../../packages/im/agent/src/core/turn-completion-usage.ts),
[observer](../../packages/im/ai/src/llm/bridge/request-observation.ts).

`usageFromAiSdk` maps reported cache tokens and retains whether each field was actually reported.
Missing cache usage is not proof of no cache. A local `stats.reused` increment is not proof of a
hit, and a fixture's `cachedContentTokenCount` tests only that the bridge parses that field.
This audit has no live provider evidence, gateway revision check or price verification.

## Existing local tests and unverified combinations

| Existing source tests | What their assertions establish | What they do not establish |
| --- | --- | --- |
| `ai/tests/llm/gemini-context-cache.test.ts`, `gemini-cache-request.test.ts` | Mock fetch: cache create/reuse, sequential prefix replacement and DELETE attempt, near-TTL create, missing cache fallback, unsupported/backoff, scene exclusion, separate Adapter owners and standalone lightweight reuse | Real CRUD acceptance/billing, concurrent create/change/delete, cancellation and disposal, exact server expiry, gateway account affinity, stream/nonstream explicit-cache interaction under one long-lived owner |
| `ai/tests/llm/google-gemini-provider.test.ts` | Installed SDK with synthetic transport: wire image/function/signature handling, stable prefix, cache usage parsing | Real implicit-cache hit ratio or discount; proxy-native explicit cache support |
| `ai/tests/ai-sdk-prompt-cache.test.ts`, `llm/system-prompt-cache-breakpoint.test.ts`, `llm/provider-prompt-cache.test.ts`, `llm/providers/openai-compatible.test.ts` | Local options/wire requests, stable tool ordering, opt-outs, signed history adjacency, current/prior Anthropic boundaries and compatible-key opt-in | Provider retention/eviction, actual cache hit/billing, complete prompt-policy reload across a retained loop and runtime replacement |
| `agent/tests/prompt/stable-prefix.test.ts`, `context/runtime-context-cache-prefix.test.ts` | Local assembly/projection: sender-neutral prefix, body/quote/media history boundary, per-turn tails and storage separation, one shared Skill hint | Measured upstream prefix hits; full live account changes across policy reload |
| `ai/tests/memory/prompt-context.test.ts`, `agent/tests/context/history-window.test.ts`, `ai/tests/compaction/context-budget.test.ts` | Trusted reference/delta semantics; A → B → A and cut restoration; token-window anchors/limits; converted schema and structured-output accounting | Tokenizer-exact provider windows, visual tokens/prices, end-to-end fixed-budget closure invalidation under every tool reload |
| `agent/tests/media/local-image-inspection.test.ts` | Private asset authority, request-local duplicate elimination and distinct asset identities | Repeated perception work across provider-level retries, upstream image-cache pricing or retention |

Paths in the table are beneath `packages/im/`. The table records source assertions rather than a
new run of every listed suite. The following narrower baseline was executed against unchanged
production cache code.

## Executed synthetic baseline

Three test files pass locally: 19 tests, with a separate ESLint pass. New assertions are in
`packages/im/ai/tests/llm/prompt-policy-cache-baseline.test.ts`,
`packages/im/ai/tests/llm/gemini-context-cache.test.ts` and
`packages/im/agent/tests/core/agent-loop-standalone-cache.test.ts`.
These run the installed SDKs against intercepted synthetic HTTP; they do not contact providers.

Inspectable samples are saved in `/tmp/zhin-prompt-policy-baseline-evvpcrkh/cache/` (nine scenarios,
38 request bodies). `summary.json` records body statistics, routing keys and cache-ID sequences;
scenario JSON contains only method/path/body, hashes, expected result, observed result, conclusion
and unverified cases. Headers, URL query strings and authentication values are excluded.
The temporary `capture-cache.mts` beside that directory can repeat the same fixed input into a
separate after-directory. It uses existing source/harness paths and introduces no production hook
or evidence-capture configuration.

| Case | Expected | Observed local result | Conclusion |
| --- | --- | --- | --- |
| Google same system/schema, then changed schema | Reuse c1, then create/reference c2 | `c1 → c1 → c2`; changed schema is in the new create body | No stale schema observed on this sequential path. |
| Lightweight text completions sharing their Adapter | Reuse c1, then replace it when supplied system changes | `c1 → c1 → c2`; old resource DELETE attempted | Retaining `#textRuntime` does not retain obsolete system bytes. |
| Actual standalone loop sharing an injected runtime | Same cache behavior, isolated task history per run | `c1 → c1 → c2`; final generation contains TASK_2, not TASK_0/TASK_1 | Retained transport and isolated conversation are distinct. |
| Google cache-use 404 | Full-body fallback, local invalidation, recreate next call | `c1 → no cache ID → c2` | Missing remote ID is not reused on the next call. |
| Google provider explicit mode plus stream `promptCache: false` | Preserve current independent-switch behavior | One create; `c1 → c1` | Stream hint opt-out does not currently disable separately configured explicit caching. No global disable policy is introduced. |
| OpenAI and opted-in compatible gateway | Same routing label, fresh policy/schema; opt-out omits routing key | A then B payloads have equal routing keys and different content; C omits key | Routing-key reuse does not mean old prompt reuse. |
| Anthropic stream and nonstream | Breakpoints mark current system/input; opt-out omits markers | B body contains B with ephemeral markers and no A; C has no cache_control | Markers are reapplied to current content, not a previous prompt snapshot. |

Logs: `/tmp/zhin-prompt-policy-cache-baseline.log` and
`/tmp/zhin-prompt-policy-cache-baseline-lint.log`. One initial new test failed because the old
test helper matched `streamGenerateContent` but excluded lowercase `generateContent`; the helper
now recognizes both. That was a test observation bug, not a production cache bug. The new policy
mutation baselines pass without changing production source. Concurrent cache operations, cache
create/delete cancellation, server-side retention and real cache/billing acceptance remain unverified.

The same temporary runner was subsequently executed into
`/tmp/zhin-prompt-policy-baseline-evvpcrkh/after-cache/` while the production cache scope
(`packages/im/ai` and the standalone runner) remained unchanged. All nine scenarios / 38 request
bodies, cache-ID sequences, routing keys, hashes and the summary are byte-identical to baseline
(ten JSON artifacts). Comparison details are in the sibling `cache-comparison.json`.
This is an after comparison for the stable cache scope, not a claim that the entire prompt-policy
assembly or deployment is frozen. It needs repeating only if the cache scope actually changes.

## Adjacent application caches, outside provider prompt identity

`FileStateCache` keys normalized file paths and holds bounded content/partial views;
`CachedToolFilter` keys normalized query/options and invalidates its score cache when the tool-set
hash changes. They are public local utilities, not a provider prefix/answer cache. Their existence
does not establish that the full Agent request path uses them. No audited main prompt assembly
reads either cache as its system prompt. Evidence:
[file cache](../../packages/im/ai/src/file-state-cache.ts),
[tool-filter cache](../../packages/im/ai/src/agent/tool-filter.ts).

Potential verification work should start from the actual entry and owner above, capture synthetic
wire requests before/after a concrete policy change, and distinguish content, routing hints,
upstream resource IDs and reported usage. No credential read or provider request is authorized by
this inventory.
