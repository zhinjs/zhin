---
"@zhin.js/command": major
"@zhin.js/handler": major
"@zhin.js/core": major
"@zhin.js/interaction": minor
"@zhin.js/adapter": minor
"@zhin.js/agent": patch
"@zhin.js/adapter-qq": minor
"@zhin.js/adapter-kook": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-telegram": minor
"@zhin.js/adapter-dingtalk": minor
"@zhin.js/adapter-lark": minor
"@zhin.js/cli": patch
"zhin.js": major
---

Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.
