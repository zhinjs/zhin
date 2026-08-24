# @zhin.js/prompt-section

## 0.0.1

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13
