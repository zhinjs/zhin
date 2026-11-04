---
'@zhin.js/agent': patch
---

Upgrade note for ADR 0044 C3 (activity feedback reads capabilities, not platform names): `@zhin.js/agent` no longer exports the per-platform `PLATFORM_FEATURES` table or the `PlatformFeatures` type. `buildTypingSendContent` now takes the conversation's capabilities instead of a platform name — `buildTypingSendContent(capabilities, options, text)`, where `capabilities` is `Pick<ActivityFeedbackKindCapabilities, 'needsReply'>` (quote the trigger message when `needsReply` is true, i.e. `delivery.proactive === false`). Code that read `PLATFORM_FEATURES[platform]` should read the adapter's capability profile (`feedback`, `actions.reaction`, `messaging.edit`, `messaging.recall`) through `TurnCapabilities` / `EndpointCapabilities.kinds` instead.
