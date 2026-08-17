---
'@zhin.js/agent': major
'@zhin.js/a2a': minor
'@zhin.js/cli': patch
---

Replace the concrete `AIService` and `ZhinAgent` escape hatches on `AgentHostPort`
with a canonical protocol port that lists immutable Agent bindings and executes
`TurnRequest`s. `AgentRuntime` selections now require the immutable binding for
the turn so provider/model state remains isolated across concurrent requests.

Route A2A tasks through the canonical Agent runtime without synthetic IM
messages or shared `agent.configure()` mutation. A2A callers now enter as a
fail-closed `user` principal, cancellation propagates through the turn
`AbortSignal`, and task completion continues to project through the A2A event
bus.
