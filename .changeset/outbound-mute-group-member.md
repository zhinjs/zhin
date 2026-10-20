---
"@zhin.js/plugin-runtime": patch
"@zhin.js/cli": patch
"@zhin.js/testing": patch
---

Plugins can now mute a group member without knowing the platform. `OutboundHost.capabilities()` reports `management: ['muteGroupMember']` for Endpoints whose adapter implements `EndpointManagement.muteGroupMember`, and the new optional `OutboundHost.muteGroupMember({ adapter, endpointKey, groupId, userId, durationSeconds })` forwards to it (rejecting Endpoints that cannot mute). `FakeOutboundRootHost.supportManagement([...])` lets tests choose whether the fake Endpoint can mute.
