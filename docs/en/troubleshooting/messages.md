---
title: Find where a message stopped
description: Use observed message diagnostics to investigate prefixes, permissions, plugins, rendering and delivery
---

# Find where a message stopped

In Console, select the actual account and conversation, then open a message's diagnostic action or Recent diagnostics. Reading a diagnostic never replays the message. It requires a full-scope token for the current Host. If no record is found, check the account, parent and thread before checking process restarts and record expiry.

Inbound processing ended means only that this part of the pipeline ended. Inspect Agent work, scheduled tasks and platform delivery separately. A truncated record is incomplete; a missing step is not proof that it never ran.

| Observed result | Next check |
| --- | --- |
| Prefix mismatch | [The receiving account's prefix](#command-prefix) |
| Invalid arguments or format | [Command help and input](#command-input) |
| Permission denied | [Rules and the real actor](#permission-denied) |
| Middleware or handler failure | [The relevant plugin](#plugin-errors) |
| Handed to Agent or still processing | [The subsequent run](#agent-running) |
| Failed or unsupported delivery | [Target and message capabilities](#delivery-failed) |
| Uncertain delivery | [Verify before repeating](#delivery-unknown) |
| Image or style became text | [Target capabilities and rendering resources](#message-rendering) |

## Prefix mismatch {#command-prefix}

The prefix belongs to the account that received the message. Two accounts in one project can use different prefixes.

Check that Endpoint's configuration and active revision. Without a custom menu keyword, send `菜单`; use `/菜单` only when that account requires `/`. A prefix mismatch may still continue through ordinary chat handling.

Verify with a harmless command. Its diagnostic should show a matched command. See [command menus](../authoring/commands.md) for pagination and custom keywords.

## Invalid arguments or format {#command-input}

Read the returned help or send the command with `--help`, for example `remind --help`, using the actual prefix and namespace. Reading help still follows the command's permissions.

Check argument order, required fields, quoting and option values. `invalid` means this invocation did not enter the command's business execution. After correction, look for `executed`, then check actual deliveries separately. See [commands](../authoring/commands.md).

## Permission denied {#permission-denied}

Check the command declaration and the sender's actual identity in this conversation. Rules such as `group(id)` constrain kind and ID; they do not establish a restriction to one Bot, parent or thread. `master` implies only `trusted`, not platform administrator.

If Console exposes permission explanations, inspect the declaration first. Manually entered roles remain assumptions. Platform and custom checkers that did not run must remain unevaluated; a simulated match does not grant access. Verify with both permitted and denied identities; the denied request must not execute business logic. See [command permissions](../authoring/commands.md).

## Middleware or handler failure {#plugin-errors}

Correlate time, generation and plugin instance with Host logs. Middleware entered without completing may reflect a downstream exception; attribute failure only when the observed step supports that conclusion. For outbound review or rewriting failures, inspect that plugin before repeating a business operation.

Reproduce the repaired scenario in a test environment and inspect processing and delivery. Diagnostics omit bodies and raw exceptions; investigation does not require credentials. See [message flow](../concepts/message-flow.md).

## Handed to Agent or still processing {#agent-running}

Handoff is a routing fact. The subsequent run may wait for a model, tool or human approval. Open Agent runs for the same conversation. No delivery in the inbound record proves neither failure nor completion of the Agent.

Cancel only when the actual operation supports cancellation. Repeating the request does not advance a run. See [tool approval and policy checks](./index.md#tool-approval-stuck).

## Failed or unsupported delivery {#delivery-failed}

Inspect each delivery's actual target and result code. Check account connectivity, exact conversation identity and the Endpoint's declared message capabilities. Text support does not imply image, Markdown or button support. Platform acceptance does not mean the recipient read the message.

After establishing that the original request was not sent, verify minimal text with a test target. For uncertain results, follow the next section. See [offline Endpoints](./index.md#endpoint-offline).

## Uncertain delivery {#delivery-unknown}

Inspect the original target conversation and reconcile the associated task or operation receipt. A disconnect, process interruption or missing trusted receipt can occur after the platform processed a request.

Do not automatically retry `unknown` or recreate the task to resend. Reconcile administrator tasks first; available actions come from the task provider. See [personal reminders](../solutions/reminders.md) for their reconciliation steps.

## Images or styles fall back to text {#message-rendering}

Check target image support separately from an available HTML renderer. Both are required to generate and deliver an image. Markdown, images and buttons are independent capabilities.

Inspect observed rendering and fallback facts. Missing resources, rendering failure or target limitations should retain readable text, links, lists and required actions. Readable, accepted text demonstrates the fallback path. Raw HTML or internal objects require investigation of rendering and adapter declarations. See [message flow](../concepts/message-flow.md).
