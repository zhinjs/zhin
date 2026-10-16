---
title: Structured Agent replies
description: JSON Schema for rich IM replies, mentions and ordered message segments
---

# Structured Agent replies

IM conversations default to `ai.agent.outputSchema: segments`. The model returns
one JSON object for every final answer, including plain text:

```json
{
  "segments": [
    { "type": "markdown", "data": { "content": "**Result**\n" } },
    { "type": "mention", "data": { "target": "123456789" } },
    { "type": "text", "data": { "text": ", please take a look." } },
    { "type": "image", "data": { "media": { "kind": "url", "value": "https://example.com/result.png" } } }
  ]
}
```

The JSON is a transport contract, not user-visible text. Segment order is
preserved. An empty `segments` array means no reply is needed. Markdown uses
`data.content`; attachments use canonical `data.media` references. Keep attachments
and mentions as segments instead of embedding image syntax or literal `@name` in Markdown.

## Supported content and identity

The model schema supports text, mention, markdown, image, audio, video, file,
reply, forward, face, dice, rps and share. It derives the required fields from the
Core canonical contract, with a closed Markdown content shape for the renderer
extension. All objects are closed and all exposed properties are required.
| Segment | Required `data` fields |
| --- | --- |
| `text` | `text: string` |
| `markdown` | `content: string` |
| `mention` | `target: string` |
| `image / audio / video / file` | `media: { kind, value }` |
| `reply` | `message_id: string` |
| `forward` | `forward_id: string` |
| `face` | `id: string` or `number` |
| `dice / rps` | Empty object |
| `share` | `url: string`, `title: string` |

Media `kind` is `url / path / base64 / file`; its value is respectively a URL,
local path, inline base64 or opaque platform file reference. Reuse references
provided by context or tools. Readable media uses existing byte inspection;
unreadable, mismatched or oversized media produces an attachment-unavailable notice.
Opaque references stay on the platform, so the host cannot check their byte size.

Optional presentation fields, platform extensions and interaction callbacks stay
with tools and renderers. The full plugin/tool segment contract is unchanged.

Mention targets must be actual platform user IDs from the current conversation
context or a member lookup tool. The current sender is identified by `Sender id`.
If a name is ambiguous or no lookup is available, ask for clarification instead of
guessing. Schema validation establishes shape, not ID authenticity or membership.
Existing tool discovery, skills and permissions still control member lookup.

## One delivery path

The Agent validates the complete object, then shares the structured output between
the final turn event and ReplyPort. Markdown stays intact for the existing renderer;
media still passes through capability and attachment-size handling. Sending uses
`Message.$reply` / `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage`
→ Endpoint. No adapter-specific send API is introduced.

The IM output type lives in `@zhin.js/agent`; the reusable `@zhin.js/ai` engine stays
transport-neutral. Intermediate tool calls use their own schemas. Progress summaries
remain text; the final tools-off summary after budget exhaustion uses the same
message schema. Console completion previews and logs project the validated output.

## Failures and compatibility

Invalid JSON, extra fields or any invalid segment reject the entire final answer.
The harness does not strip Markdown fences, extract JSON from prose, send partial
valid segments, or fall back to literal nickname mentions. It buffers final JSON
until validation before emitting a readable preview. Existing outbound leak checks
inspect text, Markdown and nested segment strings. Invalid formatting does not rerun
tools or repeat completed side effects. Host-generated error/fallback messages do
not need model encoding.

The default requires a provider/model supporting this JSON Schema alongside tool
calls. Unsupported providers follow the existing error path. Applications that
intentionally need plain text can set `ai.agent.outputSchema: false`; literal @ text
then remains text. Detached subagents and non-IM entry points do not inherit the IM
preset. Custom schemas retain their caller-owned contract without the IM prompt.

Tests use scripted providers to verify schema propagation, lookup followed by a
mixed reply, ordering, strict rejection, recovery, media policies and leak masking.
They do not prove real group notifications, client rendering or compatibility with
every production provider.
