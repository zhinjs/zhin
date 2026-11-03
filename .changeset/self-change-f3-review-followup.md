---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Self-change approval visibility follow-up (#1142): IM diff excerpts redact secret-like `key = value` / `key: value` assignments (`redactSecretAssignments`, `isSecretLikeKey`; prompt-like config paths use `isPromptPayloadKey`) and keep content lines that look like file headers; line-ending-only changes are marked; an unreadable rollback snapshot is reported instead of diffing the disk. `plugin.root.self-change-detail` returns every trial check (each redacted), redacts config values without hitting the depth limit, and no longer carries an unredacted `change.trial`.

The Console detail diff (`files[].diff`) now goes through the same secret-assignment redaction as the IM excerpt; the scanner skips escaped quotes and redacts unquoted values past spaces (up to `,` `;` `)` `]` `}` or the line end). The nested `change.trial` is allow-listed to the documented trial fields, and `change.error` / trial check messages are redacted with the audit masking plus secret assignments.
