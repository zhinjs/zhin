---
title: Feature Matrix and Layered Configuration
description: The Console Features section - enable, disable and override features at the global, adapter and account levels; inheritance and lock rules; permissions
---

# Feature Matrix and Layered Configuration

The same feature often needs different settings on different platforms and accounts: no RSS on one QQ account, a single item per push on one Telegram account. The Console **Features** section manages three levels ([ADR 0050](../../adr/0050-layered-feature-config.md)):

| Level | Key | Where it is stored |
| --- | --- | --- |
| Global | — | The plugin's own configuration block; global on / off is `disable_plugins` |
| Adapter | Adapter instance alias (a top-level key such as `qq` or `tg-main`) | `overrides.adapters.<alias>` |
| Account | `<alias>/<endpointId>`, e.g. `qq/bot-1` | `overrides.endpoints."<alias>/<endpointId>"` |

```yaml
rss:
  maxItems: 5
  overrides:
    adapters:
      qq: { enabled: false }
    endpoints:
      "tg-main/news": { maxItems: 1 }
```

`overrides` is plain YAML; editing it by hand and editing it in the Console are equivalent.

## Pages {#pages}

| Route | Page | Read / write permission |
| --- | --- | --- |
| `/features` | Feature matrix | `feature.view` / `feature.toggle` |
| `/features/global/:plugin` | Global configuration (schema form) | `feature.view` / `feature.configure` |
| `/features/adapters` | Adapter list: alias, type, account count, online count | `feature.view` |
| `/features/adapters/:adapter` | Adapter page: feature overrides for this adapter + account connection management | `feature.*`; adding, changing, starting and stopping accounts needs `endpoint.manage` |
| `/features/adapters/:adapter/endpoints/:endpoint` | Account configuration: feature overrides for this account | `feature.*` |
| `/features/ai` | AI and models (model routing, skills, Ambient, venues) | `agent.view` / `agent.configure` |

The old plugin-detail configuration page redirects to `/features/global/:plugin`. The account workspace in the **Conversations** section has a "Feature configuration" link to the matching account page.

## Feature matrix {#matrix}

Rows are features; columns are "Global" plus one per adapter instance. Each cell is a three-state switch:

- **enabled**;
- **disabled**;
- **disabled by a higher level and locked** — hovering shows "disabled at global / adapter qq" with a link.

Cells with overrides are marked. Click a feature name for its global configuration, or a cell for that level's page. The data comes from `feature.matrix`.

## Inheritance {#resolution}

**Enabled: the higher level wins.** Once the global or adapter level disables a feature, a lower level cannot switch it back on:

```text
effectively enabled = not in disable_plugins
                    and overrides.adapters[alias].enabled is not false
                    and overrides.endpoints[alias/id].enabled is not false
```

**Other fields: the lower level wins.** Effective configuration = global → adapter override → account override, deep-merged in order: plain objects merge key by key, arrays and scalars replace, and `null` means "explicitly cleared", not "inherit".

Every field shows its source badge: "inherited from global", "inherited from adapter", "overridden here". Editing an inherited field creates an override; an overridden field has "Remove override" to return to inheritance.

- A plugin that does not declare the adapter / account levels (omitting `x-zhin-config.levels` at the schema root means global only) does not appear on adapter and account pages.
- Global-only fields (database connections, API keys) are shown read-only on lower-level forms.
- Plugins without a configuration schema get only the three-level on / off switch, no field overrides.
- Secret values are returned masked.

## When changes apply {#apply}

| What changed | How it applies |
| --- | --- |
| Only `overrides` (including adapter / account on / off) | In place: no restart, no plugin reload; the next message reads the new value |
| Global fields | Per the field's declared `x-zhin-config.effect` |
| Global on / off (`disable_plugins`) | Instance restart (handled by the gateway; the Console stays connected) |

When a feature is disabled for an account, the Runtime skips it at dispatch: commands do not match (and do not answer "disabled"), middleware and handlers do not run, and Agent tools are neither visible nor callable in that account's conversations. Capabilities that do not go through messages, such as scheduled tasks, check `isEnabledFor` themselves.

## RPC and permissions {#rpc}

| RPC | Permission | Purpose |
| --- | --- | --- |
| `feature.list` | `feature.view` | All features and their supported levels |
| `feature.matrix` | `feature.view` | Matrix data |
| `feature.get` | `feature.view` | Schema, values, effective values and sources for one level |
| `feature.set-override` | `feature.configure` | Write an override (merge patch) |
| `feature.remove-override` | `feature.configure` | Remove a whole level or specific fields |
| `feature.set-enabled` | `feature.toggle` | The global level writes `disable_plugins`; other levels write `overrides.*.enabled` |

`feature.configure` and `feature.toggle` are checked against scope: an operator bound to adapter `qq` can change overrides on `qq` and its accounts only, not global or other adapters. Every write carries the configuration revision, so concurrent edits are rejected rather than overwriting each other.

For plugin authors — declaring levels and reading effective configuration (`context.configFor` / `context.isEnabledFor`) — see [ADR 0050](../../adr/0050-layered-feature-config.md).
