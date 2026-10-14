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
| `inbound` | One message, or an array run as consecutive turns in the same session. Each message has `text`, an optional `scope` (`private` or `group`), an optional `sender` (`id`, `name`, `roles`), optional `backgroundEvents` (rendered as untrusted conversation events), and an optional `policy` override. |
| `tools` | Mocked tools: `name`, `description`, `result` (a value or `(args) => value`), `error`, and `requiresApproval`. Built-in reserved names such as `read_file` or `bash` are rejected, so give mocks their own names. |
| `approval` | How the fake approval channel answers: `approve` (the default), `deny`, or `unavailable` (no channel). |
| `agentConfig` | Partial `ZhinAgentConfig`, for example `maxIterations`, `toolBudget`, or `subagentTurnMode: 'sync'`. |
| `source` | Required. The issue, PR or QQ incident the case guards against. |
| `skip` | Skip with an actionable reason (a known gap or an unmerged dependency). |
| `nativeTools` | Real native tools (`bash`, `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`) that run against `workspace`. `bash` never runs a shell: it returns `bashOutput`. |
| `workspace` | Files (relative path → content) written to a temporary directory. That directory becomes the turn's `workspaceRoot` with workspace-write access. Set `shell: true` on an inbound message to grant the isolated shell policy. |
| `script` | Ordered steps. Each is `{ text }`, `{ toolCalls: [{ name, args, notOffered? }], text? }`, or `{ fault }`. |
| `allowUnusedSteps` | Set it to allow trailing script steps the harness never requested. Off by default. |

### Assertions (`expect`)

| Key | Passes when |
|---|---|
| `toolsCalled` / `toolsNotCalled` | The tool's mock did or did not actually run, after policy and approval. |
| `outboundContains` / `outboundNotContains` | The joined reply-port text, including progress updates, contains or omits each string. |
| `noRawToolOutput` | No mocked tool result of 24 characters or more appears verbatim in the outbound text. |
| `approvalRequested` | `true`, `false`, or a list of tool names that must have been sent for approval. |
| `termination` | The last turn's terminal event type: `turn_end` (the default), `error`, `turn_cancelled`, or `budget_exceeded`. |
| `modelInputContains` / `modelInputNotContains` | What the model received (messages and tool results, not the system prompt) contains or omits each string. Use these for harness notes, hints and tool-output hygiene. |
| `outboundMessages` | The number of reply-port sends. |
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
| `group-member-no-file-write` | approval, injection | #719 group_member turn tightening (PR #737) (skipped: depends on #737) |
| `group-member-no-outbound` | approval, injection | #719 group_member turn tightening (PR #737) (skipped: depends on #737) |
| `group-member-no-shell` | approval, injection | #719 group_member turn tightening (PR #737) (skipped: depends on #737) |
| `group-member-read-only-lookup` | tool-use | #719 group_member turn tightening — only shell/write/outbound are removed (PR #737) |
| `session-history-carried` | context, memory | QQ: follow-up questions lost the previous turn (baseline for #730 compaction / told-ledger) |
| `subagent-approval-routed` | subagent, approval | #718 sub-agent approvals routed to the parent requester |
| `subagent-no-bash-when-parent-cannot` | subagent, tool-use | QQ: sub-agent overreach — child had tools the parent turn could not use (#718 deriveSubagentPolicy) |
| `subagent-sync-report` | subagent, long-task | #718 sync sub-agents on the plugin-runtime path |
| `tool-result-summarized` | tool-use | QQ: raw tool output (JSON payload) pasted straight to the user (#716 H1 / tool-calls-user-format) |
| `unknown-tool-hinted` | tool-use | QQ: model invented a tool name and the turn looped on "Unknown tool" (#716 core-tools-loaded) |

## Conventions

- One behaviour per case. Reproduce the bug first, then fix it (see #736).
- Keep scripts minimal, and assert on what the user sees rather than on
  internals.
- Tags: `long-task` (budgets, continuation, exhaustion), `context` (what reaches
  the model), `memory` (cross-turn recall), `injection` (untrusted input and
  trust tiers), `tool-use`, `approval`, and `subagent`.
- Every case names its `source`. When a case documents a known gap, keep it
  with `skip` and a linked issue rather than deleting it.
