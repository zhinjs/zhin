---
'@zhin.js/agent': patch
---

Remove dead classic Plugin and Adapter runtime bridges. Agent activity feedback now depends on the explicit Adapter `EndpointControl` port, dangerous-tool allowlists come only from the current turn context, and the unused global Adapter registry cleanup and typing example integration are gone.
