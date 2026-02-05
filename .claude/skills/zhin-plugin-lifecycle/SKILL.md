---
name: zhin-plugin-lifecycle
description: Guides creation of Zhin plugins with lifecycle hooks, auto-loading, and hot-reload behavior. Use when developers need plugin structure, lifecycle events, or reloading details.
license: MIT
metadata:
  author: zhinjs
  version: "1.0"
  framework: zhin
---

# Zhin Plugin Lifecycle Guide

Use this skill to help developers scaffold and reason about Zhin plugins, including lifecycle hooks, auto-loading behavior, and hot-reload interactions.

## Plugin Scaffold

Start with the minimal plugin entry file that uses `usePlugin()` so Zhin can create a plugin instance for the file:

```ts
import { usePlugin } from '@zhin.js/core'

const plugin = usePlugin()

plugin.onMounted(() => {
  plugin.logger.info(`Plugin ${plugin.name} mounted`)
})

plugin.onDispose(() => {
  plugin.logger.info(`Plugin ${plugin.name} disposed`)
})
```

### Key Concepts

- `usePlugin()` creates (and registers) the plugin instance based on the current file path.
- Plugin names are derived from the file path (package name or folder name).
- `plugin.onMounted` runs after contexts are mounted and child plugins start.
- `plugin.onDispose` runs when the plugin is stopped or reloaded.

## Hot Reload Behavior

In development mode (`NODE_ENV=development`), the core will watch plugin files and trigger reloads when they change.

```ts
plugin.onMounted(() => {
  plugin.logger.debug('Plugin ready for HMR')
})
```

### Reload Flow

1. File changes trigger `plugin.reload()`.
2. The plugin is stopped via `plugin.stop()`.
3. Parent re-imports the plugin entry file.
4. `mounted` lifecycle events fire again.

If the plugin is the root plugin, reload exits the process (`exit code 51`) so the CLI can restart it.

## Adding Child Plugins

Use `plugin.import()` to load child plugins relative to the current file:

```ts
await plugin.import('./sub-plugin/index.ts')
```

Notes:
- The core prevents double-loading the same resolved path.
- Child plugins are stopped automatically when the parent stops.

## Common Diagnostics

- `plugin.features` returns registered commands, components, crons, and middleware names.
- `plugin.info()` returns a nested tree of features for the plugin and its children.

Use this to build "health" commands for debugging plugin loads.

## Checklist When Authoring Plugins

- Ensure the entry file calls `usePlugin()` once.
- Use `onDispose` to clean up timers or external connections.
- Use `plugin.import()` for dependent plugins.
- Prefer `plugin.onMounted` for deferred setup once contexts are ready.
