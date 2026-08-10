---
zhin: patch
---

refactor(zhin): replace PermissionFeature with createPermissionHost

Zhin entry point now creates a standalone PermissionHost and passes it to
the message dispatcher, removing the legacy PermissionFeature registration.
Command permit checks are unified through the new permission system.
