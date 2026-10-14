---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
---

feat(agent): trust tiers and initiator binding (#726). Each turn now has an initiator trust level (owner / trusted_member / group_member), and its authority is that level's ceiling intersected with the configured policy. This replaces the #719 group-member special case; group-member turns keep the same restrictions, but denials now report the `trust-level` policy. Sub-agent reports, third-party plugin prompt sections, skill instructions and background group events are rendered as labelled `external_content`, and traces record the initiator trust level.
