# Agent evals (PR gate)

Deterministic, agent-level regression cases for the plugin-runtime turn path
(`FullAgentTurnEngine`, the path IM/QQ turns take). Each case scripts the model
step by step and asserts on what the **harness** did: which tools ran, what
reached the user, whether approval was asked, and how the turn ended.

```bash
pnpm eval:agent          # builds dependencies (turbo, cached) and runs the suite
```

The run takes a few seconds and is a required CI step. Real-model evals with
semantic assertions are a separate nightly tier (#723) and are not part of
this gate. Request-hash record/replay is intentionally not used.

## How a case runs

1. `framework/scripted-model.ts` registers a fake provider. **Every model
   request consumes the next script step, in order**, across the whole case.
   That includes requests the harness makes on its own, such as the
   exhausted-budget summary or progress updates. A synchronous sub-agent runs
   inside the parent's `spawn_task` call, so its requests come between the
   parent's in script order.
2. `framework/driver.ts` builds a real `ZhinAgent` host (with `AgentCore` and
   the session and context systems) around that model. It then creates one
   canonical `TurnIngress` per inbound message and runs it through
   `FullAgentTurnEngine`. Mocked tools are always loaded, approvals go to a
   fake approval channel, and every reply-port send is recorded.
3. `framework/assertions.ts` checks the `expect` block. When a case fails, the
   report lists each broken expectation and a trace of every model request:
   the tools offered, the tools the script called, the user text, and the
   outbound messages.

## Writing a case

Add `cases/<id>.case.ts`. The file is picked up automatically.

```ts
import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'weather-summarized',                 // kebab-case, unique
  description: 'Replies in prose without pasting the raw tool payload.',
  tags: ['tool-use'],
  inbound: { text: '上海天气？', scope: 'private', sender: { id: 'u1', roles: ['user'] } },
  tools: [{ name: 'get_weather', result: '{"condition":"rain","tempC":18}' }],
  script: [
    { toolCalls: [{ name: 'get_weather', args: { city: 'Shanghai' } }] },
    { text: '上海小雨，18°C。' },
  ],
  expect: {
    toolsCalled: ['get_weather'],
    outboundContains: ['小雨'],
    noRawToolOutput: true,
    termination: 'turn_end',
    modelSteps: 2,
  },
});
```

### Fixture fields

| Field | Meaning |
|---|---|
| `inbound` | One message, or an array run as consecutive turns in the same session. Each message has `text`, an optional `scope` (`private` or `group`), an optional `sender` (`id`, `name`, `roles`), optional `backgroundEvents` (rendered as untrusted conversation events), optional `images` (`{ base64, mimeType, name? }`, see `fixtures/images.ts`), and an optional `policy` override. |
| `tools` | Mocked tools: `name`, `description`, `parameters` (JSON Schema of the arguments, sent to the model), `result` (a value or `(args) => value`), `error`, and `requiresApproval`. Cases with `live` checks must declare every argument their script passes, or a real model has nothing to fill in. Built-in reserved names such as `read_file` or `bash` are rejected, so give mocks their own names. |
| `approval` | How the fake approval channel answers: `approve` (the default), `deny`, or `unavailable` (no channel). |
| `agentConfig` | Partial `ZhinAgentConfig`, for example `maxIterations`, `toolBudget`, or `subagentTurnMode: 'sync'`. |
| `promptSections` | Prompt sections from a third-party plugin (`{ plugin, title, content }`). They are owned by a child plugin, so the engine labels them `external_content`. |
| `source` | Required. The issue, PR or QQ incident the case guards against. |
| `skip` | Skip with an actionable reason (a known gap or an unmerged dependency). |
| `nativeTools` | Real native tools (`bash`, `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`) that run against `workspace`. `bash` never runs a shell: it returns `bashOutput`. |
| `workspace` | Files (relative path → content) written to a temporary directory. That directory becomes the turn's `workspaceRoot` with workspace-write access. Set `shell: true` on an inbound message to grant the isolated shell policy. |
| `script` | Ordered steps. Each is `{ text }`, `{ toolCalls: [{ name, args, notOffered? }], text? }`, or `{ fault }`. |
| `models` | Extra model ids registered after the primary `scripted-model`, in fallback order (they become the turn's later `modelCandidates`). A step's optional `model` pins which model must receive that request. |
| `modelInput` | Input modalities the scripted model declares (default `['text']`). Add `'image'` so turn images reach it. |
| `allowUnusedSteps` | Set it to allow trailing script steps the harness never requested. Off by default. |

### Assertions (`expect`)

| Key | Passes when |
|---|---|
| `toolsCalled` / `toolsNotCalled` | The tool's mock did or did not actually run, after policy and approval. |
| `outboundContains` / `outboundNotContains` | The joined reply-port text, including progress updates, contains or omits each string. |
| `noRawToolOutput` | No mocked tool result of 24 characters or more appears verbatim in the outbound text. |
| `approvalRequested` | `true`, `false`, or a list of tool names that must have been sent for approval. |
| `approvalQuestionContains` | Strings that must appear in at least one approval question (e.g. the provenance chain). |
| `termination` | The last turn's terminal event type: `turn_end` (the default), `error`, `turn_cancelled`, or `budget_exceeded`. |
| `modelInputContains` / `modelInputNotContains` | What the model received (messages and tool results, not the system prompt) contains or omits each string. Use these for harness notes, hints and tool-output hygiene. |
| `systemPromptContains` | Every model request's system prompt contains each string (for example a trust label on a plugin section). |
| `outboundMessages` | The number of reply-port sends. |
| `streamToolEvents` | Tool events (`tool_call:name`, `tool_result:name`, `tool_denied:name`) that stream consumers see, in order. The stream is derived from the turn journal. |
| `modelIds` | The model id of every request, in order (fallback cases). |
| `modelImages` | Image blocks the model received in each request, in order (multimodal cases). |
| `modelSteps` / `maxModelSteps` | The exact count, or the upper bound, of model requests across the case. |

A case also fails on any of these, whatever its `expect` block says:

- script steps the harness never requested;
- model requests made after the script ran out (the harness may otherwise turn
  the provider error into a polite reply);
- a scripted tool call to a tool the harness did not offer on that request,
  because a real model could not make that call.

### Withheld tools and faults

- `notOffered: true` on a scripted tool call means the harness must **not**
  offer that tool on that request, because of policy, an unknown name, or a
  deferred tool. The call is still sent, so the harness's handling of it is
  exercised. The case fails if the tool was offered after all.
- `{ fault: { kind: 'error', message, status? } }` rejects that model request
  with a `ScriptedProviderError` carrying `status`. `{ fault: { kind: 'empty' } }`
  returns an assistant message with no content. A malformed tool call is just
  a `toolCalls` step with odd `args`. These fault steps are generic, for
  provider-resilience cases (#724).
- `{ fault: { kind: 'hang' } }` never answers. It advances the case's virtual
  clock (`framework/fake-clock.ts`) until the request is aborted, normally by
  `providerResilience.requestTimeoutMs`, so timeout cases never wait in real
  time. With no pending timer it fails at once instead of blocking the suite.
  `runEvalCase(definition, { clock })` accepts your own clock; by default each
  case gets a fresh fake clock.
- `{ fault: { kind: 'error', message, status, body } }` also carries a raw
  provider JSON `body` (as the AI SDK's `responseBody`), for Gemini errors whose
  meaning is in the body: `{ error: { status: 'RESOURCE_EXHAUSTED', details: [...] } }`
  with `RetryInfo` or a `QuotaFailure`.
- `{ fault: { kind: 'finish', finishReason, raw?, blockReason? } }` returns the
  reply the AI SDK bridge builds for a content-less finish, through the same
  `resolveFinish` mapping: `finishReason: 'content-filter', raw: 'SAFETY'` is a
  Gemini safety block, `blockReason: 'PROHIBITED_CONTENT'` a blocked prompt, and
  `finishReason: 'error', raw: 'MALFORMED_FUNCTION_CALL'` a malformed function call.

Set `EVAL_VERBOSE=1` to include every model input in failure reports.

## Case catalog

| Case | Tags | Guards against |
|---|---|---|
| `approval-approved-runs` | approval | #716 typed approval outcomes (happy path baseline) |
| `approval-denied-not-retried` | approval | QQ: approval silently denied and the model kept retrying (#716 agent-im-approval) |
| `approval-unavailable-typed` | approval | #716 typed approval outcomes (no channel ≠ user said no) |
| `auto-continuation-master-dm` | long-task | #718 auto-continuation (default: master private chat) |
| `background-event-not-answered` | context, injection | QQ: the bot answered a stale background message instead of the new one (#716 event-feed self-filter) |
| `bash-hidden-without-shell-policy` | tool-use | QQ: bash unavailable but the model kept trying it (#716 agent-im-bash-policy) |
| `bash-master-isolated-runs` | tool-use | #716 ai.agent.masterShell: isolated (baseline for the no-shell cases) |
| `budget-extends-on-progress` | long-task, tool-use | #718 progress-aware budget (long edits stopped at maxIterations) |
| `budget-no-extend-on-failures` | long-task, tool-use | #718 progress-aware budget (failure streaks must not earn more steps) |
| `budget-no-extend-on-repeat` | long-task | #718 progress-aware budget (looping must not earn more steps) |
| `deferred-tool-autoloaded` | tool-use | #716 core-tools-loaded: direct calls to deferred catalog tools used to fail with "Unknown tool" |
| `exhausted-summary-fallback` | long-task | #716 H1 fallback path |
| `exhausted-turn-summary` | long-task, tool-use | QQ: iterations exhausted → user got a dump of tool output with no summary (#716 H1) |
| `exploration-budget-hint` | long-task, context | QQ: the model explored file after file without acting (#716 exploration harness) |
| `grep-match-all-rejected` | context, tool-use | #716 agent-file-tool-hygiene (grep ".*" flooded the context) |
| `grep-skips-node-modules` | context, tool-use | QQ: grep scanned node_modules and blew the context (#716 agent-file-tool-hygiene) |
| `group-master-unaffected` | approval | #719 group_member turn tightening — master must not be affected (PR #737) |
| `group-member-impersonates-owner` | approval, injection | #726 trust tiers — impersonating the owner |
| `group-member-no-file-write` | approval, injection | #719 group_member turn tightening (PR #737) |
| `group-member-no-outbound` | approval, injection | #719 group_member turn tightening (PR #737) |
| `group-member-no-shell` | approval, injection | #719 group_member turn tightening (PR #737) |
| `group-member-read-only-lookup` | tool-use | #719 group_member turn tightening — only shell/write/outbound are removed (PR #737) |
| `hard-gate-self-config-write` | approval, injection | #1030 P0: owner turns rewrote host config (`zhin.config.yml`) without a fresh human approval |
| `merged-turn-mentions-each-sender` | context | #1049 ADR 0038 §3: a merged group turn sees every sender and @s each one it answers |
| `merged-turn-skipped-sender-not-mentioned` | context | #1049 ADR 0038 §3: a merged reply does not @ senders it skips |
| `multimodal-group-image-described` | multimodal | #769 Gemini switch — group images were replaced by a text placeholder |
| `multimodal-image-question-answered` | multimodal | #769 Gemini switch — image + question in one message |
| `multimodal-text-follow-up` | multimodal, memory | #769 Gemini switch — text follow-up about an earlier image |
| `multimodal-text-only-model-placeholder` | multimodal | #769 Gemini switch — text-only models still never get image bytes |
| `plugin-prompt-injection` | injection | #726 trust tiers — plugin / skill prompt injection |
| `provider-5xx-fallback-model` | long-task | #724 provider resilience (5xx → fallback model) |
| `provider-billing-no-same-provider-fallback` | long-task | #724 provider resilience: 402 / out of credit → no pointless same-key fallback |
| `provider-deepseek-insufficient-resource-retried` | long-task | #724 provider audit S9: DeepSeek insufficient_system_resource → retry |
| `provider-gemini-context-overflow-compacted` | context, long-task | #724 provider audit S2: one shared context-overflow detector (Gemini / Vertex / Anthropic wording) |
| `provider-gemini-daily-quota-fallback` | long-task | #724 provider resilience, Gemini primary (#770): daily quota → fallback without retry |
| `provider-gemini-deadline-exceeded-polite` | long-task | #724 provider resilience, Gemini primary (#770): 504 DEADLINE_EXCEEDED → timeout |
| `provider-gemini-malformed-function-call-reasked` | long-task | #724 provider resilience, Gemini primary (#770): MALFORMED_FUNCTION_CALL → re-ask (model-harness preset) |
| `provider-gemini-prompt-blocked-polite` | long-task | #724 provider resilience, Gemini primary (#770): blocked prompt → no retry, no fallback |
| `provider-gemini-rate-limit-retry-delay` | long-task | #724 provider resilience, Gemini primary (#770): 429 RESOURCE_EXHAUSTED → retry |
| `provider-gemini-safety-block-polite` | long-task | #724 provider resilience, Gemini primary (#770): safety block → no retry, no fallback |
| `provider-gemini-unavailable-fallback` | long-task | #724 provider resilience, Gemini primary (#770): 503 UNAVAILABLE → retry → fallback |
| `provider-empty-reply-default` | long-task | #724 provider resilience (empty reply, default emptyReplyRetries: 0) |
| `provider-empty-reply-reasked` | long-task | #724 provider resilience (empty reply, model-harness quirk preset) |
| `provider-malformed-tool-call` | tool-use | #724 provider resilience (malformed tool call) |
| `provider-openai-insufficient-quota-not-retried` | long-task | #724 provider audit S19: OpenAI insufficient_quota retried uselessly |
| `provider-rate-limit-retried` | long-task | #724 provider resilience (rate limit → retry) |
| `provider-retries-exhausted-polite` | long-task | #724 provider resilience (retries exhausted → friendly feedback) |
| `provider-timeout-exhausted-polite` | long-task | #724 provider resilience (timeouts exhausted → friendly feedback) |
| `provider-timeout-retried` | long-task | #724 provider resilience (request timeout → retry) |
| `session-history-carried` | context, memory | QQ: follow-up questions lost the previous turn (baseline for #730 compaction / told-ledger) |
| `subagent-approval-routed` | subagent, approval | #718 sub-agent approvals routed to the parent requester |
| `subagent-no-bash-when-parent-cannot` | subagent, tool-use | QQ: sub-agent overreach — child had tools the parent turn could not use (#718 deriveSubagentPolicy) |
| `subagent-report-injection` | subagent, injection | #726 trust tiers — sub-agent reports are external_content |
| `subagent-sync-report` | subagent, long-task | #718 sync sub-agents on the plugin-runtime path |
| `tool-result-summarized` | tool-use | QQ: raw tool output (JSON payload) pasted straight to the user (#716 H1 / tool-calls-user-format) |
| `unknown-tool-hinted` | tool-use | QQ: model invented a tool name and the turn looped on "Unknown tool" (#716 core-tools-loaded) |

## Nightly real-model tier (#723)

`evals/nightly/` runs a **model capability matrix** against real Gemini models
once a night (`.github/workflows/nightly-evals.yml`, scheduled plus
`workflow_dispatch`). It is a trend metric, never a PR gate: it does not run on
pull requests and low pass rates do not fail the job.

| Case | Capability | Passes when |
|---|---|---|
| `matrix-tool-call-format` | tool-call format | `get_weather` is called with a `city` argument naming 上海 |
| `matrix-parallel-calls` | parallel calls | one response calls `get_weather` for both 北京 and 广州 |
| `matrix-long-context` | long context | the code buried in ~10k characters of filler is returned |
| `matrix-zh-instruction` | Chinese instruction following | exactly three `- ` lines, in Chinese, nothing else |
| `matrix-multimodal-image` | multimodal | names the colour (红 / red) and shape (圆 / circle) of the committed `fixtures/images.ts` red-circle PNG |

The multimodal column needs a model that declares image input (Gemini models
do by default); text-only models record it as skipped without a request.

Each case is one request, run `runsPerCase` times per model. Checks are
semantic (tool names, arguments, key facts, structure), not exact wording.
`semantic.ts` also exposes an `LlmJudge` interface for open questions; the
built-in matrix does not use it, so the judge costs nothing by default.

**Seed cases on real models.** After the matrix, every seed case (`cases/`)
that declares `live` checks is replayed end to end through the same driver as
the PR gate, with `createLiveModel` (`framework/live-model.ts`) in place of the
scripted model: `runEvalCase(definition, { model: () => createLiveModel({ port, model }) })`.
The script and `expect` are ignored; the case is graded by its `live.checks`,
built from the helpers in `framework/live-checks.ts` (`executed`,
`notExecuted`, `neverOffered`, `executedWithArg`, `replyMatches`,
`lastReplyMatches`, `replyNotMatches`, `turnsCompleted`). They look at
behaviour (which tools ran or were offered, key facts and intent in the reply),
not wording. Report rows are `seed-<id>` with capability `seed-case`.

The PR gate also runs each case's `live.checks` on its **scripted** run, so a
check that the expected behaviour itself would fail is caught deterministically
in CI, with no network. Cases with live checks today: `group-member-no-shell`,
`group-member-no-file-write`, `group-member-no-outbound`,
`group-member-read-only-lookup`, `dm-stranger-no-shell`,
`session-history-carried`, `leak-secret-masked`.

```ts
live: { checks: (run) => [live.notExecuted(run, 'bash'), live.replyMatches(run, /不支持|无法/, 'reply declines')] },
```

**Budget** (hard caps in `budget.ts`; every request goes through
`BudgetedCompletionPort`, and once a cap is hit the rest of the run is recorded
as skipped):

| Setting | Default | Env override |
|---|---|---|
| Runs per case per model | 3 | `NIGHTLY_RUNS_PER_CASE` |
| Max requests per run | 120 | `NIGHTLY_MAX_REQUESTS` |
| Max total tokens per run | 600,000 | `NIGHTLY_MAX_TOKENS` |
| Max output tokens per request | 1,024 | `NIGHTLY_MAX_OUTPUT_TOKENS` |
| Request timeout | 120 s | `NIGHTLY_REQUEST_TIMEOUT_MS` |

The default run (1 model, 3 runs per case) is about 15 matrix requests (~61k
tokens) plus about 50 seed-case requests (~300k tokens, since each carries the
full agent system prompt). Models come from `NIGHTLY_MODELS` (workflow input, else the
`NIGHTLY_MODELS` repository variable, else `gemini-3.5-flash-lite`, the current
stable Flash-Lite per ai.google.dev and the API's model list; see `DEFAULT_NIGHTLY_MODEL`
in `providers.ts`).
Requests go through the `google` SDK, so seed cases exercise the same Gemini
provider as production, including images and implicit prompt caching.

**Rate limits** (`rate-limit.ts`; CI's key is on the Gemini free tier, which has a
per-minute (RPM) and a daily (RPD) request quota per project and model. RPD resets at
midnight Pacific. See https://ai.google.dev/gemini-api/docs/rate-limits and the
project's limits in AI Studio):

- Everything is serial: one workflow run at a time (`concurrency: nightly-evals`, no
  matrix), one test file and test at a time (`fileParallelism: false`,
  `maxConcurrency: 1`), and one request at a time through `RateLimitedCompletionPort`.
- Request starts are at least `NIGHTLY_MIN_REQUEST_INTERVAL_MS` apart (code default
  4 s = 15 RPM; CI's gemini default 5 s = 12 RPM), counting every multi-turn and tool
  step, retries included.
- A per-minute 429 is retried after 2 s, 4 s, then 8 s, or after Google's `RetryInfo`
  `retryDelay` / `Retry-After` when that is longer. After 3 retries the request fails
  (that trial fails). The SDK's own retries are off (`maxRetries: 0`), and production
  provider defaults are unchanged.
- A daily-quota 429 (`PerDay` / RPD) is never retried. The run stops, every remaining
  trial is recorded as failed ("not run"), the report's `fatal` says the free-tier daily
  quota is exhausted, and the job fails. It never passes or skips.
- A 503 UNAVAILABLE ("model is currently experiencing high demand") is retried once,
  after a jittered 8–15 s wait or a longer `Retry-After` / `retryDelay`. If the retry is
  503 too, that run is recorded as **provider-unavailable**. It is shown in the
  "Not counted" column, left out of the pass rate, and is not a model failure. For a
  seed case, the run is provider-unavailable when it failed and one of its turns stayed 503.
- Retries are real requests. They go through the pacer and count against
  `NIGHTLY_MAX_REQUESTS`, so a retry never exceeds the budget. A retry the budget
  refuses makes that run budget-skipped.
- **Infra-flaky:** when more than half of the attempted (non-skipped) runs are
  provider-unavailable, the report says so (`infra.flaky`, an **Infra-flaky** banner,
  regressions marked untrusted) and the job **fails** with an `infra-flaky: …` message.
  Such a night carries no quality signal, and failing keeps it from becoming the next
  night's diff baseline (the baseline is the last *successful* run). Below that line the
  job behaves as before: low pass rates never fail it.
- Nothing else is retried or reclassified (500, 400, timeouts, failed checks). A run whose
  answer failed a check stays a failure even when other runs were 503s.
- Budget-skipped runs are listed in a **Budget-skipped** line and in the "Not counted"
  column, so a short night is visible at a glance.

A full run at 3 trials sends about 82 requests on `gemini-3.5-flash-lite`: 15 matrix
requests plus ~67 seed-case requests (tool steps included), and a few 503 retries.

Measured free-tier limits on CI's key (from the API's own 429 quota metadata, via the
workflow's `quota-probe` mode):

| Model | RPM | RPD |
|---|---|---|
| `gemini-3.5-flash-lite` (default) | 15 | 500 |
| `gemini-3.8-flash` | 5 | 20 |

So for `gemini` the workflow defaults to 3 trials, `NIGHTLY_MAX_REQUESTS=120` (24% of
the 500 RPD, which leaves room for a few manual dispatches a day) and
`NIGHTLY_MIN_REQUEST_INTERVAL_MS=5000` (12 RPM, 80% of the limit). That is ≥7 min
(7.8 min observed), and ≥10 min at the cap. The repository variables `NIGHTLY_RUNS_PER_CASE`,
`NIGHTLY_MAX_REQUESTS` and `NIGHTLY_MIN_REQUEST_INTERVAL_MS`, and the `runs_per_case` /
`models` dispatch inputs, override them. For `gemini-3.8-flash` use 1 trial, 20 requests
and 12000 ms.

**Quota probe:** dispatch the workflow with `mode: quota-probe` (plus `models`,
`probe_max_requests`, `probe_concurrency`). It lists the models the key can see and sends
tiny requests until the API's 429s reveal the RPM (`…PerMinute…` `quotaValue`) and, if
reached, the RPD (`…PerDay…`). It burns quota on purpose. The key is never printed, and
its artifact (`quota-probe-report`) is never used as a nightly baseline.

**Secrets:** the workflow reads the `GEMINI_API_KEY` repository secret (and the
optional `GEMINI_BASE_URL` repository variable for a pass-through proxy). Without it the job logs a notice and skips.
The key is passed only as an environment variable and is never printed.

**Reports:** `eval-reports/nightly.json` (pass rate, average tokens and average
tool calls per model × case), `nightly-diff.json` and `nightly.md` (the diff
against the previous successful night, with regressions of 20 points or more
flagged). They are uploaded as the `nightly-eval-report` artifact and the
Markdown goes to the job summary.

Run it locally with `GEMINI_API_KEY=… pnpm eval:nightly` (after `pnpm build`).

**Provider:** Gemini is the default. Set `NIGHTLY_PROVIDER=minimax` (workflow
input `provider`, or the `NIGHTLY_PROVIDER` repository variable) to run the same
matrix on MiniMax with the `MINIMAX_API_KEY` secret (default model `minimax-m3`,
temperature 0.2); without that secret the job logs a notice and skips. Matrix
requests to Gemini send no temperature, since Gemini 3.6+ ignores it and warns.

## Conventions

- One behaviour per case. Reproduce the bug first, then fix it (see #736).
- Keep scripts minimal, and assert on what the user sees rather than on
  internals.
- Tags: `long-task` (budgets, continuation, exhaustion), `context` (what reaches
  the model), `memory` (cross-turn recall), `injection` (untrusted input and
  trust tiers), `tool-use`, `approval`, and `subagent`.
- Every case names its `source`. When a case documents a known gap, keep it
  with `skip` and a linked issue rather than deleting it.

## Multi-message ingress cases (#725)

`ingress-cases/*.case.ts` (run by `ingress.eval.ts`, part of `pnpm eval:agent`) feed several timed messages to one session through the IM admission protocol, the same `TurnAdmissionGate` calls the CLI IM ingress route makes. A cancel intent (`取消`, `/cancel`) calls `gate.stop`, and every other message calls `gate.admit`. Each `run` admission executes one real agent turn with the scripted model and the admitted (possibly merged) text. Time is virtual: `at` is the arrival time, `turnMs` is how long each turn runs, and the same clock drives the queue TTL.

| Expectation | Checks |
|---|---|
| `turns` | The turns in start order: `sender`, `text`, `status` (`completed` / `cancelled`), `mergedMessages`, `supersededPrevious`. |
| `merged` | `sender:text` for each message folded into a queued turn. |
| `rejected` | `sender:reason` (`queue_full` / `expired` / `stopped`). |
| `stops` | `sender:result` for each cancel intent (`stopped` / `forbidden` / `not_running`). |
| `notices` | The notices users receive (queue full, expired, stop confirmation). |

The route lives in `@zhin.js/cli`, which this package cannot import, so `framework/ingress.ts` mirrors its admission steps. Keep the two in sync.
