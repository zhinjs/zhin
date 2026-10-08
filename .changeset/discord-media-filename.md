---
"@zhin.js/adapter-discord": patch
---

Use the canonical media MIME type to assign a filename extension when an outbound attachment has no explicit name, allowing Discord to display image previews instead of unknown file attachments.

Preserve canonical reply message references in Gateway sends so quote replies reference the original message rather than silently sending plain text.
