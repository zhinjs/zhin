---
title: "Docs Writing Guide"
description: "Page types, layout templates, progressive disclosure and language rules for the Zhin.js user docs"
---

# Docs writing guide

This guide answers one question: **how does a first-time reader finish a page able to do one thing, without the page getting in the way of readers who want to go deeper?**

Read it before rewriting or adding pages under `docs/`. Layout rules apply to user docs (Start, Use, Plugin Development, AI, Operations). ADRs and target-architecture docs are exempt from the layout but still follow the [language rules](#language-rules).

## Three principles

1. **Results first, internals later.** Readers come to get something done. Lead with copy-pasteable steps and a visible result; put the mechanism in a "How it works" section or link to [Under the Hood](../concepts/architecture.md).
2. **One new concept at a time.** Every term the reader hasn't seen gets a one-sentence explanation on the spot, or a link to [Core concepts](../getting-started/concepts.md). Never stack more than two new terms in one paragraph.
3. **The default path goes in the body; exceptions go in collapsibles.** What 90% of readers do belongs in the text. Edge cases, compatibility notes and internals go in `::: details` or a closing "Going deeper" section.

## Page types

Every page belongs to exactly one type. The type decides the layout.

| Type | Reader's question | Where | Examples |
| --- | --- | --- | --- |
| **Tutorial** | "Walk me through it" | Start | Quick start, First plugin |
| **Guide** | "How do I get X done?" | Use, Plugin Development, AI, Operations | Commands, adapters, deployment |
| **Concept** | "Why is it designed this way?" | Under the Hood | Plugin model, message flow |
| **Reference** | "What does this field / flag mean?" | Reference | Config fields, CLI, API |

Don't mix types on one page. If a guide drifts into internal data structures, that part belongs on a concept page.

## Layout templates

### Guide page

```md
# Verb-first title (e.g. Declare command parameters)

One sentence: what this page helps you do. One sentence: what you will see afterwards.

::: tip Before you start
What must be finished or installed first (delete this block if nothing is required)
:::

## The most common form
A complete, copy-pasteable minimal example plus its result.

## Common tasks
### Task A
### Task B
Each section: scenario sentence → code → result sentence.

## How it works (optional)
Three to five sentences, linking to concept pages.

## FAQ / Troubleshooting (optional)

## Next steps
2–4 links, each saying what reading it lets you do.
```

### Concept page

```md
# Noun (e.g. Plugin model)

One paragraph: what problem this concept solves, introduced through a concrete scenario.

## One diagram
A mermaid or text diagram that shows only what the reader needs to remember.

## Core rules
3–5 rules, each one sentence plus an example.

## Details
Expand as needed; field tables, edge cases, and error types go here.

## Related
```

### Reference page

A reference page may be long, but every section must be findable on its own: the heading is the field or command name, the first sentence states its purpose, then comes a table or code.

## Progressive disclosure

A page descends in layers, and the reader may stop at any one:

| Layer | Content | Stopping here, the reader can… |
| --- | --- | --- |
| 1. First two sentences | What the page does, what you'll see | decide whether the page is for them |
| 2. Minimal example | One copy-pasteable snippet | do the most common task |
| 3. Common tasks | Sections by scenario | do 80% of tasks |
| 4. Internals and details | Mechanism, edge cases, full field tables | handle rare cases |
| 5. Links | Concept, reference, source | go deeper |

In practice:

- **Examples grow from small to large.** The first example shows one thing; each later example adds one capability.
- **Field tables come after examples.** Show the usage first, then the full fields; never open with a table of a dozen rows.
- **Internal vocabulary sits low.** `generation`, `projection`, `Capability Slot`, `Scope`, `Token` and other implementation terms appear only in layer 4; layers 1–3 say "hot reload", "registers automatically", "plugin resources" — words the user can perceive.
- **Fold exceptions away.** Compatibility notes, migration caveats, and maintainer-only constraints go in `::: details Title`.
- **At most one `::: warning` per page.** Too many warnings equal none; keep only what causes data loss, a security issue, or failure to start.

## Layout rules

- **Headings**: one H1 per page. Guide H2s are verb phrases ("Declare parameters", "Send an image"); concept H2s are nouns. No deeper than H3.
- **Paragraphs**: one idea per paragraph, at most four lines. Split long paragraphs into a list or table.
- **Lists and tables**: use a list for three or more parallel options; use a table only when comparing two or more dimensions. No long sentences in table cells.
- **Code blocks**:
  - The first line is a comment with the file path (`// commands/hello/index.ts`) so the reader knows where it goes.
  - Show only code relevant to the topic; use `// ...` for the rest.
  - Use `bash` for shell examples and `text` for directory trees, with `#` comments after the key lines.
- **Callouts**: `tip` for shortcuts and advice, `warning` for things that go wrong, `details` for skippable detail. Don't put body text in callouts.
- **Links**: link text says what the reader gets ("[Add permissions to a command](../authoring/commands.md)"); never "click here" or "see this".

## Language rules

### Use the reader's words, not the implementation's

| Don't write | Write |
| --- | --- |
| Capabilities enter the current generation's projection | Saved files register automatically and take effect after hot reload |
| Topology source of truth | The `zhin` field in `package.json` decides which plugins are installed |
| Feature provider discovers the convention directory | Files in `commands/` are recognized as commands automatically |
| Injected through a Host Token | Take it from `context.resources` |
| Golden path | Default path / simplest path |
| Closed loop | The complete flow / end to end |
| SSOT | Single source (maintainer docs only) |

Internal terms aren't banned — on concept and reference pages they are the precise names. The rule: **explain them on first use, and never open a page with them.**

### Sentences

- **Active voice, second person.** "You create a file in `commands/`", not "a file should be created in `commands/`".
- **One idea per sentence.** More than two commas is a hint to split.
- **Say what to do before why.** "Put the key in `.env` so it is never committed to Git", not the other way round.
- **Concrete beats abstract.** `/remind 10 drink water` instead of "a command with parameters"; "two QQ accounts" instead of "multiple Endpoint instances".
- **Avoid "simply", "just", "obviously".** When a reader is stuck, these words make it feel like their fault.
- **No marketing language.** "Powerful", "elegant", "ultimate" carry no information; say what it does.

### Mixing Chinese and English

These rules apply to the Chinese pages; the English pages keep the matching conventions for code and product names.

- Chinese pages put a space between Chinese and English text or numbers: `安装 zhin.js 后`, `默认端口 8068`.
- Code, package names, file names, and commands go in backticks: `` `zhin.config.yml` ``.
- Product names stay as they are: Zhin.js, Console, Sandbox, Agent. Chinese pages translate generic concepts (plugin, command, middleware, adapter).
- Chinese pages use full-width punctuation; code and English phrases keep half-width punctuation.

### Keeping Chinese and English pages in sync

Chinese is the source language and `docs/en/` holds the matching translation. When you add or rewrite a Chinese page, update the English page's structure (heading levels, examples, links) in the same PR; wording may follow English idiom and need not be word-for-word.

## Pre-submit checklist

- [ ] Can a reader tell from the first two sentences whether this page is for them?
- [ ] Does the first code block run as-is, with a file path?
- [ ] Is every new term in the first half explained or linked?
- [ ] Is internal vocabulary confined to the second half?
- [ ] Any paragraph over four lines, or more than one warning?
- [ ] Is there a "Next steps" section?
- [ ] Is the English page's structure in sync?
- [ ] Are frontmatter `title` / `description` values double-quoted? (An unquoted `: ` inside a value breaks YAML parsing and the whole site build.)
- [ ] Do `pnpm check:doc-links`, `pnpm check:doc-orphans` and `pnpm docs:build` pass?
