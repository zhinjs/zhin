---
"@zhin.js/workroom": patch
---

Workroom B4 fail-closed fixes.

- `createRoomTaskAuthorizer` is now fail-closed for `assign`: every `assign` is refused unless an `authorizeAssign` role check (lead / coordinator) allows it, since `assign` skips the handoff depth and ping-pong limits. It is composable through `next` for the other commands (membership / `handoffTo` stay with C1). It only covers `cancel` and `assign`.
- `guards.cancelRoom`: any human may still interrupt the running turn, but rejecting and clearing the queue requires an `authorizeSensitive('room.cancel_queue')` account (new `RoomSensitiveOperation`).
- `checkHandoff` now requires `history`; a call without it is refused with `guard_error` and `escalateToHuman` instead of skipping the ping-pong check.
- `admitTurn` is removed from the public `RoomGuards` interface; `runExclusive` is the only admission path (one slot per turn).
- Send limiter: new `createRoomSendLimiter` returns one shared instance with a `send` form and an outbound `middleware` form (`RoomSendRateLimitedError` on refusal); `createRateLimitedOutbound` stays as a wrapper.
  **C1 must make every outbound of a member Endpoint (`$reply`, generation output and the Room Bus projection) share this one limiter instance**, as an outbound middleware or by wrapping the shared `OutboundMessageService`. Wrapping only the Room Bus outbound under-counts the account.
