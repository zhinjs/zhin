---
'@zhin.js/core': patch
'zhin.js': patch
---

Remove the unmounted classic Schedule, AgentPreset, and MessageFilter Feature registries. Plugin Runtime scheduling now has one owner-scoped authority through `scheduleHostToken`, Agent presets have one authority in the Agent Feature and Resource Hub, and message admission remains in the active middleware and guardrail pipeline.
