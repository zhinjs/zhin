---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Self-change approval visibility follow-up (#1142): IM diff excerpts redact secret-like `key = value` / `key: value` assignments (`redactSecretAssignments`, `isSecretPayloadKey`) and keep content lines that look like file headers; line-ending-only changes are marked; an unreadable rollback snapshot is reported instead of diffing the disk. `plugin.root.self-change-detail` returns every trial check (each redacted), redacts config values without hitting the depth limit, and no longer carries an unredacted `change.trial`.
