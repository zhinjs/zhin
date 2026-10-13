---
title: Docs Writing Guide
description: Page types, layout templates, progressive disclosure and language rules for the Zhin.js user docs
---

# Docs writing guide

This guide answers one question: **how does a first-time reader finish a page able to do one thing, without the page getting in the way of readers who want to go deeper?**

Read it before rewriting or adding pages under `docs/`. Layout rules apply to user docs (Start, Use, Plugin Development, AI, Operations). ADRs and target-architecture docs are exempt from the layout but still follow the [language rules](#language-rules).

Chinese is the source language; the full guide with more examples lives at [文档写作规范](../../contributing/writing-docs.md).

## Three principles

1. **Results first, internals later.** Readers come to get something done. Lead with copy-pasteable steps and a visible result; put the mechanism in a "How it works" section or link to [Under the Hood](../concepts/architecture.md).
2. **One new concept at a time.** Every term the reader hasn't seen gets a one-sentence explanation on the spot, or a link to [Core concepts](../getting-started/concepts.md). Never stack more than two new terms in one paragraph.
3. **The default path goes in the body; exceptions go in collapsibles.** What 90% of readers do belongs in the text. Edge cases, compatibility notes and internals go in `::: details` or a closing "Going deeper" section.

## Page types

| Type | Reader's question | Where | Examples |
| --- | --- | --- | --- |
| **Tutorial** | "Walk me through it" | Start | Quick start, First plugin |
| **Guide** | "How do I get X done?" | Use, Plugin Development, AI, Operations | Commands, adapters, deployment |
| **Concept** | "Why is it designed this way?" | Under the Hood | Plugin model, message flow |
| **Reference** | "What does this field / flag mean?" | Reference | Config fields, CLI, API |

Don't mix types on one page. If a guide drifts into internal data structures, that part belongs on a concept page.

## Guide template

```md
# Verb-first title (e.g. Declare command parameters)

One sentence: what this page helps you do. One sentence: what you will see afterwards.

::: tip Before you start
(delete if nothing is required)
:::

## The most common form
A complete, copy-pasteable minimal example plus its result.

## Common tasks
### Task A
Scenario sentence → code → result sentence.

## How it works (optional)
Three to five sentences, linking to concept pages.

## Troubleshooting (optional)

## Next steps
2–4 links, each saying what reading it lets you do.
```

## Progressive disclosure

A page descends in layers, and the reader may stop at any one:

| Layer | Content | Stopping here, the reader can… |
| --- | --- | --- |
| 1. First two sentences | What the page does, what you'll see | decide whether the page is for them |
| 2. Minimal example | One copy-pasteable snippet | do the most common task |
| 3. Common tasks | Sections by scenario | do 80% of tasks |
| 4. Internals and details | Mechanism, edge cases, full field tables | handle rare cases |
| 5. Links | Concept, reference, source | go deeper |

- **Examples grow from small to large**; each adds one capability.
- **Field tables come after examples**, never as the opening.
- **Internal vocabulary sits low.** `generation`, `projection`, `Capability Slot`, `Scope`, `Token` appear only in layer 4; layers 1–3 say "hot reload", "registers automatically", "plugin resources".
- **At most one `::: warning` per page**, reserved for data loss, security issues or failure to start.

## Layout rules

- One H1 per page. Guide H2s are verb phrases; concept H2s are nouns. No deeper than H3.
- One idea per paragraph, at most four lines.
- Lists for three or more parallel options; tables only when comparing two or more dimensions.
- Code blocks start with a file-path comment (`// commands/hello/index.ts`), show only relevant code (`// ...` for the rest), use `bash` for shell and `text` for trees.
- Link text says what the reader gets; never "click here".

## Language rules

| Don't write | Write |
| --- | --- |
| Capabilities enter the current generation's projection | Saved files register automatically and take effect after hot reload |
| Topology source of truth | The `zhin` field in `package.json` decides which plugins are installed |
| Feature provider discovers the convention directory | Files in `commands/` are recognized as commands automatically |
| Golden path | Default path / simplest path |

Internal terms aren't banned — on concept and reference pages they are the precise names. The rule: **explain them on first use, and never open a page with them.**

- Active voice, second person.
- One idea per sentence.
- Say what to do before why.
- Concrete beats abstract: `/remind 10 drink water`, "two QQ accounts".
- Avoid "simply", "just", "obviously" and marketing adjectives.
- When a Chinese page changes, update the English page's structure (headings, examples, links) in the same PR.

## Pre-submit checklist

- [ ] Can a reader tell from the first two sentences whether this page is for them?
- [ ] Does the first code block run as-is, with a file path?
- [ ] Is every new term in the first half explained or linked?
- [ ] Is internal vocabulary confined to the second half?
- [ ] Any paragraph over four lines, or more than one warning?
- [ ] Is there a "Next steps" section?
- [ ] Do `pnpm check:doc-links`, `pnpm check:doc-orphans` and `pnpm docs:build` pass?
