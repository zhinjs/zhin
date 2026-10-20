---
title: Where do messages enter and leave?
---

# Where do messages enter and leave?

**Inbound traffic enters through a platform Endpoint; outbound traffic ends at an Endpoint.** For a receive problem, trace Endpoint, inbound middleware, then command dispatch.

For a send problem, trace `$reply`, rendering, outbound middleware, then Endpoint delivery.

This path concerns ordinary IM messages. Requests, notices, and login state have their own event projections; do not debug them as one `message.receive` event.

## When a message arrives

The platform Client hands it to an Endpoint, which calls `emit('message.receive', payload)`. Runtime holds a snapshot of that event's generation, constructs a `Message`, runs inbound middleware, and dispatches commands.

A command miss can reach AI fallback only when Agent is installed.

If middleware never sees the message, check whether the Endpoint emitted `message.receive`, then its `inbound` capability and active generation.

If a command stays silent, check the prefix, command discovery, and whether middleware calls `next()`.

## When a reply leaves

A command return value or `Message.$reply()` enters the shared outbound path: render and normalize content, run outbound middleware, call `AdapterIndex.send`, then the target Endpoint's `send()`.

Proactive sends also use `OutboundMessageService.send` so rendering and middleware still apply.

The Endpoint must declare `outbound` and be started. When code ran but nothing reached the platform, check those conditions and outbound middleware first.

See [Message Flow](/en/concepts/message-flow) for the complete pipeline and event shapes, and the [adapter index](/en/adapters/) for platform-specific delivery.
