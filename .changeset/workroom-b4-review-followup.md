---
"@zhin.js/workroom": patch
---

Workroom B4 review follow-up.

- `createRoomTaskAuthorizer`: `next` is required for C1 to enforce role checks on start / block / handoff (and `handoffTo`). The missing-`next` pass-through is no longer a tested contract.
- New `limiter.outboundMiddleware()` returns an outbound middleware definition (`{ target: 'outbound', handle(ctx, next) }`, structural types, no new dependency); wrap it with `defineMiddleware(...)` in plugins. Manual adaptation: `handle: (ctx, next) => limiter.middleware(ctx.input, next)`. Never pass the context to `middleware` directly: it takes the envelope, and the limiter fails closed on every send otherwise.
- One outbound path uses exactly one form (middleware, or `send` wrapping the OutboundMessageService); mixing them double-counts. Share the instance across different paths of the same account.
- `createRateLimitedOutbound` is for tests / standalone use only.
- `RoomCancelResult.queueRefused` plus a warn log when a human without `room.cancel_queue` cannot clear a non-empty queue.
