---
title: Why is a Tool unavailable?
---

# Why is a Tool missing or waiting for approval?

**First check whether the Tool entered the current generation, then whether this conversation may use it.** Installation and discovery, conversation access, deferred loading, and execution approval are separate steps.

Changing `requiresApproval` cannot reveal a Tool that was filtered out earlier.

This page applies to projects using Agent Tools with `@zhin.js/agent` installed. A project with only commands and ordinary IM replies does not need this layer.

## Check in order

1. Does the Tool use `tools/<name>/index.ts`, and is its Feature installed and mounted? If `setup()` registers it conditionally, check that configuration first.
2. Do `platforms`, `scopes`, and `permissions` admit the current message? For example, `scopes: ['group']` excludes private chats. `hidden: true` removes it from the model's list.
3. Is it in the deferred catalog? The model can use `discover` and `load_tool` to load Tools on demand. Absence from the initial prompt does not mean the Tool was never registered.
4. Only then inspect execution approval: `requiresApproval` can be `never`, `on-risk`, `once`, or `always`. It does not relax conversation access.

Built-in execution Tools also use `execSecurity` and `execApprovalMode`. The latter's `ask | auto | bypass` is different from a Tool's `requiresApproval`.

`bypass` still respects permissions, filesystem and network boundaries, and dangerous-command checks.

See [Tool Authoring](/en/authoring/agent-tools) for definitions, access rules, and deferred loading; see [AI Setup](/en/ai/) for installation and built-in execution policy.
