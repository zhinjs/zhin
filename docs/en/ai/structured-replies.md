---
title: Structured Agent replies
description: JSON Schema for rich IM replies, mentions and ordered message segments
---

# Structured Agent replies

IM conversations default to `ai.agent.outputSchema: segments`. The model returns
one JSON object for every final answer, including plain text. Each item of
`messages` is one chat message, sent in order, made of an ordered `segments` array:

```json
{
  "messages": [
    { "segments": [{ "type": "text", "data": { "text": "Had a look" } }] },
    { "segments": [
      { "type": "mention", "data": { "target": "123456789" } },
      { "type": "text", "data": { "text": " it's the cache, clear it and you're fine" } },
      { "type": "image", "data": { "media": { "kind": "url", "value": "https://example.com/result.png" } } }
    ] }
  ]
}
```

The model decides how to split: usually one message, two or three when a person
would send a quick reaction before the answer. Follow-up messages wait a short,
length-based pause (0.4–1.5 s). A failure after the first message is reported as
`partial_delivery` and delivered messages are never resent. A legacy single
`{"segments":[...]}` reply (for example from history) is still accepted as one message.

The JSON is a transport contract, not user-visible text. Segment order is
preserved. An empty `messages` array means no reply is needed. Markdown uses
`data.content`; attachments use canonical `data.media` references. Keep attachments
and mentions as segments instead of embedding image syntax or literal `@name` in Markdown.

## Supported content and identity

The segment types offered to the model depend on the **endpoint the reply goes to**;
the schema, the instruction and the validator are generated from that one set:

- Adapter without a `segments.supported` list: text, mention, markdown, image,
  audio, video, file and keyboard.
- Adapter with `segments.supported`: only the listed types (mention, media,
  keyboard, share, dice, rps). Text is always offered; markdown and keyboard are
  also offered when the endpoint degrades them to text (`markdown: 'text'` /
  `interactive: 'text'`).

An adapter can also declare per-type platform extensions under `segments.model`.
They only change that platform's prompt and schema, never the global contract:

```ts
segments: {
  supported: ['text', 'mention', 'image', 'share' /* … */],
  model: {
    share: {
      fields: ['description', 'image', 'audio', 'platform'],   // optional string fields the model may fill
      hint: 'renders as a QQ link card. For a song, set audio to the playable link …',
    },
  },
}
```

`fields` become required strings in the model schema; the model writes `""` when it
has no real value and those empty fields are removed after validation. `hint` is
appended to that platform's reply instruction as `- share on this platform: …`.
icqq uses it so the model can turn music search results into a share card with a
playable link and cover; icqq maps `platform` (qq / netease / kugou / kuwo /
migu) to that music app's appid, so the model never fills `config.appid`.

reply, forward and face are never offered: they need platform message, forward or
emoji IDs the model has no reliable source for. A type the model picks is therefore
never rejected later as unsupported by the adapter. The schema derives the required fields from the
Core canonical contract, with a closed Markdown content shape for the renderer
extension. All objects are closed and all exposed properties are required.
| Segment | Required `data` fields |
| --- | --- |
| `text` | `text: string` |
| `markdown` | `content: string` |
| `mention` | `target: string` |
| `image / audio / video / file` | `media: { kind, value }` |
| `keyboard` | `rows: [[{ label, payload }]]`: quick-reply buttons, at most 5 per row; tapping sends the payload as the user's next message |
| `dice / rps` | Empty object |
| `share` | `url: string`, `title: string` |

Model keyboards carry only `label` and `payload`. Publishing fills in button IDs,
the `command` interaction mode and the text fallback (a numbered list where replying
with the number equals a tap), using the same builder as card buttons. Empty
keyboards are dropped.

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

When strict validation fails, Agent first repairs without a model call, and the
result must still pass the same full schema: a JSON object wrapped in a sentence or
a Markdown fence, or with a bracket too many or too few, is extracted; a reply in
plain prose with no JSON is sent as one text message; an integer ID where the
schema wants a string (a mention target) is stringified. Anything still invalid
(wrong fields, truncated JSON) gets one format-only correction; if it also fails,
the host sends a fixed failure notice.
The harness does not send partial valid segments or fall back to literal nickname
mentions. It buffers final JSON
until validation before emitting a readable preview. Existing outbound leak checks
inspect text, Markdown and nested segment strings. Invalid formatting does not rerun
tools or repeat completed side effects. Host-generated error/fallback messages do
not need model encoding.

The default requires a provider/model supporting this JSON Schema alongside tool
calls. Unsupported providers follow the existing error path. Applications that
intentionally need plain text can set `ai.agent.outputSchema: false`; literal @ text
then remains text. Detached subagents and non-IM entry points do not inherit the IM
preset. Custom schemas retain their caller-owned contract without the IM prompt.

A tool call the model wrote as text (DeepSeek DSML, `<invoke>`, `<tool_call>`) is
never sent, inside JSON or as prose, and is not reworded by the correction call,
which would announce an action that never ran; the host failure notice is sent
instead. `<text>…</text>` wrappers are split into one message each.

Tests use scripted providers to verify schema propagation, lookup followed by a
mixed reply, ordering, strict rejection, recovery, media policies and leak masking.
They do not prove real group notifications, client rendering or compatibility with
every production provider.

## Provider transport and bounded correction

MiniMax may return the final object as JSON text instead of calling the SDK's
synthetic `json` tool. The transport preserves its answer text, and Agent validates
the same full schema regardless of transport. Reasoning is never a final reply and
is never searched for JSON.

How a provider is asked for structured output is `compat.structuredOutput`:
`native` uses the provider's structured output / JSON mode; `prompt` writes the
schema into the system prompt and decodes the answer text leniently. DeepSeek
defaults to `prompt`: its thinking models in JSON mode often think and then return
only whitespace (4 of 8 replies measured), while without JSON mode 12 of 12 were
usable. Other SDKs default to `native`; set `compat: { structuredOutput: prompt }`
on a provider whose JSON mode returns empty answers.

On a schema mismatch, Agent makes at most one format-only completion without
conversation history or business tools (30-second timeout, turn cancellation
respected). Replies over 32,000 characters are not truncated for correction.
If correction fails, a fixed host notice is sent; partial model content is never
published and completed business operations are never replayed.
