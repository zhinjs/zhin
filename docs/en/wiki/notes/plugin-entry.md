---
title: Where does a capability go?
---

# Should a capability live in a convention directory or `plugin.ts`?

**Decide by whether it shares resources and lifecycle with other capabilities.** Put a standalone command, middleware, component, or Tool in a convention directory.

Use `setup()` in `plugin.ts` when several capabilities need the same resource, cleanup, or configuration decision.

This choice is for plugin authors. It does not change installation topology: declare plugins and Features in `package.json#zhin`, and keep configuration values in `zhin.config.yml`.

## One capability: use a directory

```text
my-plugin/
├── plugin.ts
└── commands/
    └── hello/
        └── index.ts
```

`commands/hello/index.ts` is one command entry. Other code capabilities normally use `<name>/index.ts`. Helper files beside the entry are not discovered as extra capabilities. Independent files can reload at capability granularity.

## Shared resources: use setup

In the default-exported `definePlugin({ setup(context) { ... } })`, resolve Host services through `context.resources`, register cleanup with `context.lifecycle.add()`, and add capabilities with methods such as `context.addCommand()`.

Check optional resources with `has(token)` first.

Choose one registration path per capability. If a directory and `setup()` declare the same name under one owner, Runtime reports a duplicate instead of overriding either one.

Build a Feature package only when the ecosystem needs a new kind of capability.

See [Convention Directories](/en/authoring/conventions) for exact paths and [definePlugin](/en/authoring/define-plugin) for resources, dependencies, and lifecycle.
