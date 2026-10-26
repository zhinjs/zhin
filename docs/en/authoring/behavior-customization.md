---
title: Customize built-in presentation
description: Root-selected command feedback, menu layouts and per-conversation outbound presentation
---

# Customize built-in presentation

Select presentation policies in the application Root's `setup` to replace command feedback, lay out a menu, or prefer text in a specific conversation. The framework retains validation, permissions, pagination and delivery.

| Change | Public entry point | Framework responsibility |
| --- | --- | --- |
| Invalid arguments, denied permissions, cooldown or busy feedback | `commandFeedbackToken` from `zhin.js/command` | Execution facts and admission |
| Current menu page layout | `commandMenuPresentationToken` from `zhin.js/command` | Catalog, 30 items per page, navigation and button lifecycle |
| HTML, Markdown and interactive text preferences | `outboundPresentationToken` from `zhin.js/middleware` | Adapter capability checks and delivery |
| Review or replace final content | [Outbound middleware](./middleware-components.md) | Existing `envelope.replace(...)` and `next()` semantics |

For just a menu title, background or accent color, keep using `menuStyle` in [Commands](./commands.md).

## Select policies in Root

Use this example as the application's `plugin.ts`. Keep its existing Command and Adapter Feature configuration. This example does not install adapters or send startup messages.

<<< ../../snippets/behavior-customization.ts

A library may export `CommandFeedbackRenderer`, `CommandMenuPresenter` or `OutboundPresentation` implementations. Root imports and binds them with `resources.provide(token, implementation)`. Installing a child plugin or binding the same token in a child does not select a global policy. Bind each token once; compose conditions in that function and return `undefined` for unhandled cases.

## Command feedback

The renderer receives immutable `feedback` and `context`:

- `feedback.status` is `invalid`, `denied` or `limited`, with the command name, original owner, and applicable `issues/help` or `limit`.
- `context` contains the full conversation, optional sender and client adapter, and generation. It omits the raw message body and sending methods.

Return text, a Segment, JSX or a registered component, synchronously or asynchronously. `undefined` retains built-in feedback. Successful command output, individual `--help`, unmatched messages and the independent progress notice do not enter this policy.

Root is the author of custom content. Registered components resolve in Root's scope; command ownership and diagnostic status remain unchanged. This policy cannot grant permission or access another plugin instance's private components.

## Menu pages

The presenter receives `{ page, conversation, generation }`. The frozen page contains `commands` and `plugins` entries with `name/description`, directory-wide `commandTotal/pluginTotal`, `page/pages`, `keyword/pluginKey`, `title/appearance`, and the same page's `text/hint` fallback.

Return only the current page content. Initial display and button navigation use the same presenter. The framework appends native controls where supported and retains first/last-page disabling and callback expiry. For a custom HTML layout, pass `page.text` as the readable fallback to `segment.html`; HTML JSX needs the explicit `<html>` / `<Html>` boundary described in [Middleware & Components](./middleware-components.md).

Catalog visibility remains unchanged: menu entries are **not a promise of per-sender permission filtering**. Execution and individual command help retain their permission checks.

## Per-conversation expression

`OutboundPresentation` is a synchronous, side-effect-free function receiving `{ conversation, requester, generation }`. It may return:

```ts
{ html: 'text', markdown: 'text', interactive: 'text' }
```

Each field accepts `default` or `text`. Omitted fields, `default`, or an entirely `undefined` result retain the adapter policy. `text` uses existing readable text conversion. It cannot grant native HTML, button or image capabilities or convert arbitrary unsupported segments.

Match the full target: `conversation.endpoint.id`, `endpoint.adapter`, `kind`, `id`, `parent` and `threadId`. Platform names or conversation IDs alone do not isolate accounts. `requester` is the content-author plugin ID, not the chat sender; sender data is only available in the feedback context.

A send resolves its preference once and reuses it after `replace(JSX)`. HTML text preference avoids screenshot calls. Target previews share the decision but do not run outbound middleware, register buttons or send messages. Do not perform network I/O or send messages from the policy.

## Failure and lifecycle

- Unbound or `undefined`: built-in presentation.
- Policy function throw, including an asynchronous feedback/menu rejection: body-free diagnostic and built-in presentation; no business re-execution.
- Lazy component rendering, outbound review or delivery fails after the callback returns: existing outbound error handling, **no second default reply**, and no automatic retry for `unknown`.
- In-flight operations retain their snapshot; new operations use the committed generation. Removing the binding restores defaults. Cancellation and old buttons retain existing lifecycle rules.

Policies are trusted application code, not a JavaScript sandbox. Their contracts expose no permission mutation, command executor or target rewrite. Authors must still avoid side effects.
