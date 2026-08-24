---
"@zhin.js/prompt-section": patch
"@zhin.js/agent": patch
"@zhin.js/core": patch
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-github": patch
---

Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.
