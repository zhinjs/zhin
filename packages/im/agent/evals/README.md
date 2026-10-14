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
| `script` | Ordered steps. Each is `{ text }` or `{ toolCalls: [{ name, args }], text? }`. |
| `allowUnusedSteps` | Set it to allow trailing script steps the harness never requested. Off by default. |

### Assertions (`expect`)

| Key | Passes when |
|---|---|
| `toolsCalled` / `toolsNotCalled` | The tool's mock did or did not actually run, after policy and approval. |
| `outboundContains` / `outboundNotContains` | The joined reply-port text, including progress updates, contains or omits each string. |
| `noRawToolOutput` | No mocked tool result of 24 characters or more appears verbatim in the outbound text. |
| `approvalRequested` | `true`, `false`, or a list of tool names that must have been sent for approval. |
| `termination` | The last turn's terminal event type: `turn_end` (the default), `error`, `turn_cancelled`, or `budget_exceeded`. |
| `modelSteps` / `maxModelSteps` | The exact count, or the upper bound, of model requests across the case. |

A case also fails on any of these, whatever its `expect` block says:

- script steps the harness never requested;
- model requests made after the script ran out (the harness may otherwise turn
  the provider error into a polite reply);
- a scripted tool call to a tool the harness did not offer on that request,
  because a real model could not make that call.

## Conventions

- One behaviour per case. Reproduce the bug first, then fix it (see #736).
- Keep scripts minimal, and assert on what the user sees rather than on
  internals.
- Example cases only live here for now. The seed set (20 or more cases tagged
  `long-task`, `context`, `memory`, `injection`, `tool-use`, and `approval`)
  comes with #721.
