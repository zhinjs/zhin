---
'@zhin.js/agent': patch
'@zhin.js/core': patch
'@zhin.js/kernel': patch
'zhin.js': patch
---

refactor: complete plugin dual-track elimination (Slices 3–4)

Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
collaboration, media, memory, prompt, and orchestrator modules); dead branches
collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
all packages.

Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
(`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
stack directly.

Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
service bus is superseded by Scope + Token (introduced in Slice 2).

Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
`AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
no longer depends on dead `init/` modules.

Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
update agent README to remove `initAgentModule` usage examples.
