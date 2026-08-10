---
'@zhin.js/cli': patch
---

refactor(cli): use provide pattern for agent host registries

Agent host installer now uses provideOrchestrationService,
provideOrchestrationRuntime, provideSessionTreeRuntime,
provideScheduleManager, and provideAssistantRuntime with lifecycle-bound
disposal instead of legacy set*/register* pattern. Start command removes
deprecated env.ts and node-warnings.ts utilities (inlined as constants).
Uninstall command recognizes config.yml/config.yaml in addition to
zhin.config.yml. readCapabilities now awaited for proper async handling.
