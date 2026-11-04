---
"@zhin.js/adapter": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0044 C1: adapter capability profile spec. `defineAdapter({ profile, resolveCapabilities })` declares seven capability groups (messaging, scene, actions, events, feedback, delivery, prompt) per conversation kind with inheritance from `default`, validated at definition time. `resolveTurnCapabilities` merges the sections and narrows them (Bot role, mute state, passive window, and the adapter's narrow-only patch), and the IM ingress attaches the result to the turn input as `platformCapabilities` (`has` / `get`). A declared action without its management/control port fails at assembly. Adapters without a profile get a conservative one derived from `capabilities`, `operations` and `segments`; `segments` and `liveDanmaku` remain as aliases. No behaviour change for existing adapters.
