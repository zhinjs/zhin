---
title: 'Upgrading: MCP Tools Authorized by Chat Role'
description: ADR 0065 upgrade notes — bound MCP servers tighten on upgrade, upstream read-only tools stay open to everyone and the rest go to the global owner; three common permit shapes and the risk of restoring the old behavior
---

# Upgrading: MCP tools authorized by chat role (ADR 0065)

From this release, MCP tools from `ai.mcpServers` go through the same chat-role authorization as plugin tools ([ADR 0065](../../adr/0065-mcp-tool-permit.md); roles are described in [Chat roles](../concepts/chat-roles.md)).

## What changes on upgrade

**This is a behavior change.** MCP servers already bound to a chat Agent (`ai.agents.<name>.mcpServers`) tighten to the new defaults as soon as you upgrade:

| Tool | Before | After (no `permit`) |
| --- | --- | --- |
| Annotated `readOnlyHint: true` upstream | Visible to everyone | Visible to everyone |
| Not annotated, annotated as writing (`readOnlyHint: false`), or also annotated `destructiveHint: true` | Visible to everyone, approved before running | Visible only to the global owner (`owner@global`) |

- Ordinary members, `trusted`, `admin`, and people who are `owner` only for one account or conversation see only the tools the server annotated read-only. Hidden tools are not in the model's tool list, `discover` / `load_tool` cannot find them, and listing them in `deferredTools.alwaysLoadedTools` does not keep them loaded.
- Before every call the sender's **current** role is read from the role store and checked again: an old call replayed from the session history, a role revoked mid-turn, or a sub-agent reusing its parent's tools is denied, recorded in the trace as `tool_denied` with `policy: mcp-permit`.
- Upstream annotations only decide who may use a tool; they **never relax approval**. MCP tools are still treated as "may write" and go through approval, the file policy, the network allowlist and the dangerous-tool hard gate as before.
- Most official MCP servers (GitHub, filesystem, …) already annotate their read tools with `readOnlyHint`. For a server without annotations, ordinary members see none of its tools after the upgrade.

The turn principal of these entry points is not the global owner either, so they also get read-only tools only:

- **Scheduled tasks**: on each run the creator's current role is recomputed and then demoted one step (`owner` → `trusted`, `trusted` / `admin` → `user`). So **a task created by the global owner cannot use owner-only MCP tools by default**; when the task's execution plan names such a tool it is missing and the run is recorded as `degraded`.
- **A2A** (including remote Mailbox mail, whatever trust the peer declares) and zhin's own **MCP Server** entry (principal role `user` / `authenticated`).

## Seeing which tools were tightened

- `zhin trace last` (or `zhin trace <turn id>`): denied calls appear as `tool_denied` with policy `mcp-permit`.
- Per-server counts ("everyone N / owner only M") arrive in `zhin status` and the Console MCP page in a later release (ADR 0065 P2). Until then, compare with `annotations.readOnlyHint` of each tool in the upstream server's `tools/list` result.

## Three common shapes

`permit` goes under each `ai.mcpServers` entry; all three keys are optional:

```yaml
ai:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ['-y', '@modelcontextprotocol/server-github']
      permit:
        readOnly: everyone        # tools annotated read-only and not matched by tools; default everyone
        default: owner@global     # every other tool; default owner@global
        tools: {}                 # overrides by upstream tool name; default {}
```

**1. Everything to the owner (the default, nothing to write)**: ordinary members get read-only tools, the owner gets all. If you do not trust a server's annotations, take the read-only tools back as well:

```yaml
      permit:
        readOnly: owner@global
```

**2. Widen or narrow single tools**: `tools` keys are the raw tool names the server reports (without the server prefix, case-sensitive); each value is a tier.

```yaml
      permit:
        tools:
          create_issue: trusted                       # widen: trusted members and scheduled tasks may use it
          merge_pull_request: [owner@global, private(*)]  # only in the owner's private chat (every item must hold)
          delete_*: deny                              # nobody
```

- A tier is `everyone`, `deny`, one permit string (`trusted`, `admin`, `owner@global`, `role(owner@global,admin@adapter)`, `platform:admin`, …, the same as one item of a plugin tool's `permissions`), or a list of such strings (all must hold). `everyone` / `deny` stand alone and cannot go into a list; an empty list is a configuration error.
- Matching: an exact name wins; otherwise the `*` pattern with the most literal characters (`create_*` has one more than `*_issue`, so it wins); several patterns with the same number of literal characters must all hold. A tool whose name contains a non-ASCII character is only matched by its exact name.
- `*` also matches tools the server adds later: widen with exact names, narrow (`deny`, `owner@global`) with wildcards.
- To allow only the listed tools (an allowlist), write both `default: deny` and `readOnly: deny`, then list the tools to open under `tools`.

An Agent can narrow one more layer in its own binding (ANDed with the server layer, it only narrows; omitted keys add no restriction):

```yaml
ai:
  agents:
    helper:
      mcpServers:
        - name: github
          permit:
            default: deny
            tools:
              get_me: everyone
```

**3. Restore the old behavior (not recommended)**:

```yaml
      permit:
        default: everyone
```

Risk: everyone sees and may call the server's writing tools. `ai.agent.execApprovalMode` defaults to `auto`, which hands approval to the automatic reviewer, so a write started by an ordinary member runs once the reviewer approves it. If you really need it, prefer shape 2 and open specific tools only.

## Configuration errors

A key under `permit` other than `readOnly` / `default` / `tools`, an empty list, `everyone` / `deny` inside a list, an invalid permit string (including removed spellings such as `master` or `scene_admin`; the error names the replacement), a repeated pattern in one layer, or the same server listed twice for one Agent all fail startup instead of exposing tools.
