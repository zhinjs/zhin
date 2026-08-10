---
'@zhin.js/agent': patch
---

refactor(agent): migrate global registries to generation-scoped stores

Replace module-level global singletons with createGenerationStore across
orchestration, schedule, session-tree, typing-indicator, assistant,
collaboration, and memory-entry registries. Pattern changes from
set*/register* to provide* with lifecycle-bound disposal. AgentDispatcher
is now owned by OrchestrationKernel instead of a global singleton.
AIService removes chat/chatStream/ask methods (use completeText).
New spawn-delegation module detects async vs sync spawn_task results.
KeyedMutex utility added for per-key async serialization.
