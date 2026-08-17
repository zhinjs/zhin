---
'@zhin.js/agent': major
'@zhin.js/core': major
'@zhin.js/runtime': major
'@zhin.js/cli': patch
---

Remove the obsolete Collaboration Scene/Cell domain after Agent coordination
moved to the Orchestration Kernel. This deletes `/collab`, the initialization
wizard, Scene identity and membership repositories, archived Cell pipeline
state, seven Collaboration database tables, and their public exports.

The top-level `collaboration` configuration key is no longer accepted and now
fails schema validation. Agent startup is selected only by `ai` or `assistant`.

Keep the optional Five-Agent workflow as an independent Agent module with
`FiveAgentRole`, role binding, and role capability policy interfaces. It no
longer depends on IM scenes, Bot membership, or text handback conventions.

Remove `StructuredOutboundDetectInput.collaborationCell`; structured outbound
selection is based only on tool, handoff, and Adapter capability requirements.
